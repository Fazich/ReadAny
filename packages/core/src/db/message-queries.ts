import type { Message } from "../types";
import { getDB, getDeviceId, nextSyncVersion, parseJSON } from "./db-core";

type MessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  citations: string | null;
  tool_calls: string | null;
  reasoning: string | null;
  parts_order: string | null;
  created_at: number;
};

// 相同时间戳沿用本地插入顺序，读取和替换须使用同一排序。
const MESSAGE_HISTORY_SQL =
  "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC";

function mapMessages(rows: MessageRow[]): Message[] {
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role as Message["role"],
    content: r.content,
    citations: parseJSON(r.citations, undefined),
    toolCalls: parseJSON(r.tool_calls, undefined),
    reasoning: parseJSON(r.reasoning, undefined),
    partsOrder: parseJSON(r.parts_order, undefined),
    createdAt: r.created_at,
  }));
}

export async function getMessages(threadId: string): Promise<Message[]> {
  const database = await getDB();
  return mapMessages(await database.select<MessageRow>(MESSAGE_HISTORY_SQL, [threadId]));
}

export async function replaceMessageHistory(
  threadId: string,
  messageId: string,
  replacement: Message,
): Promise<{ messages: Message[]; updatedAt: number }> {
  const database = await getDB();
  const rows = await database.select<MessageRow>(MESSAGE_HISTORY_SQL, [threadId]);
  const messages = mapMessages(rows);
  const threadSql = "SELECT * FROM threads WHERE id = ?";
  const threads = await database.select<{ updated_at: number }>(threadSql, [threadId]);
  const index = messages.findIndex((message) => message.id === messageId);
  if (
    threads.length !== 1 ||
    index < 0 ||
    messages[index].role !== "user" ||
    replacement.threadId !== threadId ||
    replacement.role !== "user"
  ) {
    throw new Error("The message is no longer available for editing");
  }
  const deviceId = await getDeviceId();
  const removed = messages.slice(index);
  // 慢时钟下也推进消息时间，使增量同步能收集修订及墓碑。
  const edited = {
    ...replacement,
    partsOrder: replacement.partsOrder ?? [],
    createdAt: Math.max(
      Date.now(),
      replacement.createdAt,
      ...messages.map((message) => message.createdAt + 1),
    ),
  };
  const deletedAt = edited.createdAt;
  const updatedAt = Math.max(edited.createdAt, threads[0].updated_at + 1);
  // 快照校验与写入共用写事务；有并发变更时交由调用方保留草稿并反馈冲突。
  await database.batch([
    {
      sql: "INSERT INTO messages (id, thread_id, role, content, parts_order, created_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sync_version), 0) + 1 FROM messages), ?)",
      params: [
        edited.id,
        threadId,
        "user",
        edited.content,
        JSON.stringify(edited.partsOrder ?? []),
        edited.createdAt,
        deviceId,
      ],
    },
    ...removed.flatMap((message) => [
      {
        sql: "INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at, device_id) VALUES (?, 'messages', ?, ?)",
        params: [message.id, deletedAt, deviceId],
      },
      {
        sql: "DELETE FROM messages WHERE id = ? AND thread_id = ?",
        params: [message.id, threadId],
      },
    ]),
    {
      sql: "UPDATE threads SET memory_summary = NULL, memory_updated_at = NULL, memory_message_count = 0, updated_at = ?, sync_version = (SELECT COALESCE(MAX(sync_version), 0) + 1 FROM threads), last_modified_by = ? WHERE id = ?",
      params: [updatedAt, deviceId, threadId],
    },
  ], [
    { sql: MESSAGE_HISTORY_SQL, params: [threadId], expectedRows: rows },
    { sql: threadSql, params: [threadId], expectedRows: threads },
  ]);
  return { messages: [...messages.slice(0, index), edited], updatedAt };
}

export async function insertMessage(message: Message): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "messages");
  await database.execute(
    "INSERT INTO messages (id, thread_id, role, content, citations, tool_calls, reasoning, parts_order, created_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      message.id,
      message.threadId,
      message.role,
      message.content,
      message.citations ? JSON.stringify(message.citations) : null,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.reasoning ? JSON.stringify(message.reasoning) : null,
      (message as any).partsOrder ? JSON.stringify((message as any).partsOrder) : null,
      message.createdAt,
      syncVersion,
      deviceId,
    ],
  );
}
