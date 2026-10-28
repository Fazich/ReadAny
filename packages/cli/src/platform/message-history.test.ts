import { mkdtemp, rm } from "node:fs/promises";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDB, getDB, initDatabase } from "@readany/core/db/db-core";
import {
  getMessages,
  insertMessage,
  replaceMessageHistory,
} from "@readany/core/db/message-queries";
import { insertThread } from "@readany/core/db/thread-queries";
import { setPlatformService } from "@readany/core/services";
import { applyChanges, collectChanges } from "@readany/core/sync/simple-sync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodePlatformService } from "./node-platform";

// 使用实际 Node 适配器和 SQLite，覆盖共享写入及同步消费端。
describe("修订问题的原子保存与同步", () => {
  let root: string;
  let now = 1000;

  async function open(name: string) {
    await closeDB();
    setPlatformService(new NodePlatformService({ READANY_HOME: join(root, name) }));
    await initDatabase();
    return getDB();
  }

  async function seed() {
    await insertThread({
      id: "thread",
      title: "test",
      messages: [],
      createdAt: 100,
      updatedAt: 100,
      memorySummary: "old memory",
      memoryUpdatedAt: 200,
      memoryMessageCount: 4,
    });
    const db = await getDB();
    await db.execute(
      "UPDATE threads SET memory_summary = 'old memory', memory_updated_at = 200, memory_message_count = 4 WHERE id = 'thread'",
    );
    for (const [id, role, createdAt] of [
      ["before", "assistant", 2000],
      ["old", "user", 2000],
      ["answer", "assistant", 5000],
    ] as const) {
      await insertMessage({ id, threadId: "thread", role, content: id, createdAt });
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "readany-edit-history-"));
    now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await open("source");
    await seed();
  });

  afterEach(async () => {
    await closeDB();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it.each(["insert", "content", "thread", "delete-thread"])(
    "快照读取后另一连接发生 %s 时原子拒绝替换，重试成功后返回与数据库一致",
    async (change) => {
      const db = await getDB();
      const other = new Database(join(root, "source", "readany.db"));
      const batch = db.batch.bind(db);
      const memory = await db.select("SELECT * FROM threads");
      const messages = await getMessages("thread");
      const interceptor = vi.spyOn(db, "batch").mockImplementationOnce(async (statements, checks) => {
        // 真正的 SQLite 第二连接，在共享层读完快照、事务开始前提交交错写入。
        if (change === "insert") {
          other.prepare(
            "INSERT INTO messages (id, thread_id, role, content, created_at, sync_version) VALUES ('late', 'thread', 'assistant', 'late answer', 6000, 50)",
          ).run();
        } else if (change === "content") {
          // 数量和版本均不变，仍须发现同一行正文变化。
          other.prepare("UPDATE messages SET content = 'changed' WHERE id = 'before'").run();
        } else if (change === "thread") {
          other.prepare(
            "UPDATE threads SET memory_summary = 'concurrent memory', updated_at = 9000 WHERE id = 'thread'",
          ).run();
        } else {
          other.pragma("foreign_keys = ON");
          other.prepare("DELETE FROM threads WHERE id = 'thread'").run();
        }
        return batch(statements, checks);
      });
      try {
        await expect(replaceMessageHistory("thread", "old", {
          id: "new", threadId: "thread", role: "user", content: "edited", createdAt: now,
        })).rejects.toThrow("Database changed while editing");
        expect(await db.select("SELECT * FROM sync_tombstones")).toEqual([]);
        expect((await getMessages("thread")).some((message) => message.id === "new")).toBe(false);
        if (change === "delete-thread") {
          expect(await db.select("SELECT * FROM threads")).toEqual([]);
          return;
        }
        if (change === "insert") {
          expect((await getMessages("thread")).map((message) => message.id)).toEqual([
            ...messages.map((message) => message.id), "late",
          ]);
          expect(await db.select("SELECT * FROM threads")).toEqual(memory);
        }
        const result = await replaceMessageHistory("thread", "old", {
          id: "new", threadId: "thread", role: "user", content: "edited", createdAt: now,
        });
        expect(result.messages).toEqual(await getMessages("thread"));
        expect(result.messages.map((message) => message.id)).toEqual(["before", "new"]);
        const deleted = await db.select<{ id: string }>("SELECT id FROM sync_tombstones ORDER BY id");
        expect(deleted.map((row) => row.id)).toEqual(
          change === "insert" ? ["answer", "late", "old"] : ["answer", "old"],
        );
        const versions = await db.select<{ sync_version: number }>(
          "SELECT sync_version FROM messages WHERE id = 'new'",
        );
        if (change === "insert") expect(versions[0].sync_version).toBeGreaterThan(50);
        if (change === "thread") expect(result.updatedAt).toBeGreaterThan(9000);
      } finally {
        interceptor.mockRestore();
        other.close();
      }
    },
  );

  it("末尾摘要更新失败时回滚消息、删除记录和摘要，重开数据库仍完整", async () => {
    const db = await getDB();
    const before = await getMessages("thread");
    const memory = await db.select("SELECT * FROM threads");
    await db.execute(
      "CREATE TRIGGER fail_edit BEFORE UPDATE ON threads BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    await expect(
      replaceMessageHistory("thread", "old", {
        id: "new",
        threadId: "thread",
        role: "user",
        content: "edited",
        createdAt: now,
      }),
    ).rejects.toThrow("injected failure");
    expect(await getMessages("thread")).toEqual(before);
    expect(await db.select("SELECT * FROM sync_tombstones")).toEqual([]);
    expect(await db.select("SELECT * FROM threads")).toEqual(memory);
    await open("source");
    expect(await getMessages("thread")).toEqual(before);
  });

  it("相同时间戳及慢时钟下保留前文、同步修订，旧设备快照不会复活被删消息", async () => {
    const stale = await collectChanges(0);
    const result = await replaceMessageHistory("thread", "old", {
      id: "new",
      threadId: "thread",
      role: "user",
      content: "edited",
      createdAt: now,
    });
    expect(result.messages.map((message) => message.id)).toEqual(["before", "new"]);
    expect(result.messages[1].createdAt).toBeGreaterThan(5000);
    expect(result.messages).toEqual(await getMessages("thread"));
    const db = await getDB();
    expect(
      await db.select(
        "SELECT memory_summary, memory_updated_at, memory_message_count FROM threads",
      ),
    ).toEqual([{ memory_summary: null, memory_updated_at: null, memory_message_count: 0 }]);
    const tombstones = await db.select<{ id: string; deleted_at: number }>(
      "SELECT id, deleted_at FROM sync_tombstones ORDER BY id",
    );
    expect(tombstones.map((row) => row.id)).toEqual(["answer", "old"]);
    expect(tombstones.every((row) => row.deleted_at > 5000)).toBe(true);
    const edited = await collectChanges(5000);
    expect(edited.tables.messages.records.map((row) => row.id)).toEqual(["new"]);
    expect(edited.tables.messages.deletedIds.sort()).toEqual(["answer", "old"]);
    await open("remote");
    await seed();
    await applyChanges(edited);
    await applyChanges(stale);
    await applyChanges(edited);
    expect((await getMessages("thread")).map((message) => [message.id, message.content])).toEqual([
      ["before", "before"],
      ["new", "edited"],
    ]);
    await open("remote");
    expect((await getMessages("thread")).map((message) => message.id)).toEqual(["before", "new"]);
  });
});
