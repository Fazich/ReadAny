/**
 * Edge TTS — Free high-quality Microsoft Neural TTS via Edge browser's read-aloud WebSocket API.
 *
 * Uses IPlatformService.createWebSocket to set custom headers (User-Agent, Origin, Cookie)
 * that browser native WebSocket cannot set — required by the Edge TTS server.
 *
 * Audio format: audio-24khz-48kbitrate-mono-mp3 (MP3, 24kHz, 48kbps, mono).
 */

import { getPlatformService } from "../services/platform";
import {
  type EdgeTTSMetadataEvent,
  parseEdgeTTSMetadataBody,
  parseEdgeTTSTextFrame,
} from "./edge-tts-metadata";

// ── Constants ──
const EDGE_SPEECH_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const EDGE_API_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";

const WIN_EPOCH_OFFSET = 11644473600n; // BigInt
const S_TO_NS = 1000000000n; // BigInt
const EDGE_TTS_AUDIO_CACHE_LIMIT = 48;

// ── Voice list ──
const EDGE_TTS_VOICE_MAP: Record<string, string[]> = {
  "af-ZA": ["af-ZA-AdriNeural", "af-ZA-WillemNeural"],
  "ar-SA": ["ar-SA-HamedNeural", "ar-SA-ZariyahNeural"],
  "bg-BG": ["bg-BG-BorislavNeural", "bg-BG-KalinaNeural"],
  "ca-ES": ["ca-ES-EnricNeural", "ca-ES-JoanaNeural"],
  "cs-CZ": ["cs-CZ-AntoninNeural", "cs-CZ-VlastaNeural"],
  "da-DK": ["da-DK-ChristelNeural", "da-DK-JeppeNeural"],
  "de-DE": [
    "de-DE-AmalaNeural",
    "de-DE-ConradNeural",
    "de-DE-FlorianMultilingualNeural",
    "de-DE-KatjaNeural",
    "de-DE-KillianNeural",
    "de-DE-SeraphinaMultilingualNeural",
  ],
  "el-GR": ["el-GR-AthinaNeural", "el-GR-NestorasNeural"],
  "en-AU": ["en-AU-NatashaNeural", "en-AU-WilliamNeural"],
  "en-CA": ["en-CA-ClaraNeural", "en-CA-LiamNeural"],
  "en-GB": [
    "en-GB-LibbyNeural",
    "en-GB-MaisieNeural",
    "en-GB-RyanNeural",
    "en-GB-SoniaNeural",
    "en-GB-ThomasNeural",
  ],
  "en-IN": ["en-IN-NeerjaExpressiveNeural", "en-IN-NeerjaNeural", "en-IN-PrabhatNeural"],
  "en-US": [
    "en-US-AriaNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-AndrewNeural",
    "en-US-AvaMultilingualNeural",
    "en-US-AvaNeural",
    "en-US-BrianMultilingualNeural",
    "en-US-BrianNeural",
    "en-US-ChristopherNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-EmmaNeural",
    "en-US-EricNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-MichelleNeural",
    "en-US-RogerNeural",
    "en-US-SteffanNeural",
  ],
  "es-ES": ["es-ES-AlvaroNeural", "es-ES-ElviraNeural", "es-ES-XimenaNeural"],
  "es-MX": ["es-MX-DaliaNeural", "es-MX-JorgeNeural"],
  "fi-FI": ["fi-FI-HarriNeural", "fi-FI-NooraNeural"],
  "fr-CA": ["fr-CA-AntoineNeural", "fr-CA-JeanNeural", "fr-CA-SylvieNeural"],
  "fr-FR": [
    "fr-FR-DeniseNeural",
    "fr-FR-EloiseNeural",
    "fr-FR-HenriNeural",
    "fr-FR-RemyMultilingualNeural",
    "fr-FR-VivienneMultilingualNeural",
  ],
  "he-IL": ["he-IL-AvriNeural", "he-IL-HilaNeural"],
  "hi-IN": ["hi-IN-MadhurNeural", "hi-IN-SwaraNeural"],
  "hr-HR": ["hr-HR-GabrijelaNeural", "hr-HR-SreckoNeural"],
  "hu-HU": ["hu-HU-NoemiNeural", "hu-HU-TamasNeural"],
  "id-ID": ["id-ID-ArdiNeural", "id-ID-GadisNeural"],
  "it-IT": [
    "it-IT-DiegoNeural",
    "it-IT-ElsaNeural",
    "it-IT-GiuseppeMultilingualNeural",
    "it-IT-IsabellaNeural",
  ],
  "ja-JP": ["ja-JP-KeitaNeural", "ja-JP-NanamiNeural"],
  "ko-KR": ["ko-KR-HyunsuMultilingualNeural", "ko-KR-InJoonNeural", "ko-KR-SunHiNeural"],
  "ms-MY": ["ms-MY-OsmanNeural", "ms-MY-YasminNeural"],
  "nb-NO": ["nb-NO-FinnNeural", "nb-NO-PernilleNeural"],
  "nl-NL": ["nl-NL-ColetteNeural", "nl-NL-FennaNeural", "nl-NL-MaartenNeural"],
  "pl-PL": ["pl-PL-MarekNeural", "pl-PL-ZofiaNeural"],
  "pt-BR": ["pt-BR-AntonioNeural", "pt-BR-FranciscaNeural", "pt-BR-ThalitaMultilingualNeural"],
  "pt-PT": ["pt-PT-DuarteNeural", "pt-PT-RaquelNeural"],
  "ro-RO": ["ro-RO-AlinaNeural", "ro-RO-EmilNeural"],
  "ru-RU": ["ru-RU-DmitryNeural", "ru-RU-SvetlanaNeural"],
  "sk-SK": ["sk-SK-LukasNeural", "sk-SK-ViktoriaNeural"],
  "sv-SE": ["sv-SE-MattiasNeural", "sv-SE-SofieNeural"],
  "th-TH": ["th-TH-NiwatNeural", "th-TH-PremwadeeNeural"],
  "tr-TR": ["tr-TR-AhmetNeural", "tr-TR-EmelNeural"],
  "uk-UA": ["uk-UA-OstapNeural", "uk-UA-PolinaNeural"],
  "vi-VN": ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"],
  "zh-CN": [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunxiaNeural",
    "zh-CN-YunyangNeural",
    "zh-CN-liaoning-XiaobeiNeural",
    "zh-CN-shaanxi-XiaoniNeural",
  ],
  "zh-HK": ["zh-HK-HiuGaaiNeural", "zh-HK-HiuMaanNeural", "zh-HK-WanLungNeural"],
  "zh-TW": ["zh-TW-HsiaoChenNeural", "zh-TW-HsiaoYuNeural", "zh-TW-YunJheNeural"],
};

export interface EdgeTTSVoice {
  id: string;
  name: string;
  lang: string;
}

function buildVoiceList(): EdgeTTSVoice[] {
  return Object.entries(EDGE_TTS_VOICE_MAP).flatMap(([lang, voices]) =>
    voices.map((id) => ({
      id,
      name: id.replace(`${lang}-`, "").replace("Neural", ""),
      lang,
    })),
  );
}

export const EDGE_TTS_VOICES: EdgeTTSVoice[] = buildVoiceList();

// ── Sec-MS-GEC v2 ──
// 与 edge-tts 7.3.1 的 drm.py 保持一致：
// https://github.com/rany2/edge-tts/blob/7.3.1/src/edge_tts/drm.py
// v2 使用定制的 SHA-256 初始块及 CS64，不能用标准 subtle.digest 替代。
const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const GEC_SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const GEC_SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const CS64_COEFFICIENTS = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function sigma0(value: number): number {
  return (rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3)) >>> 0;
}

function sigma1(value: number): number {
  return (rotateRight(value, 17) ^ rotateRight(value, 19) ^ (value >>> 10)) >>> 0;
}

function expandSha256Schedule(words: number[]): void {
  for (let i = words.length; i < 64; i++) {
    words.push((sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0);
  }
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = firstRound; i < 64; i++) {
    const constant = firstRound === 14 && i === 14 ? 0xc9dc06a7 : SHA256_ROUND_CONSTANTS[i];
    const t1 =
      h +
      (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) +
      ((e & f) ^ (~e & g)) +
      constant +
      words[i];
    const t2 =
      (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    [a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

function gecSha256(data: Uint8Array): Uint8Array {
  // 初始块的前 57 字节由协议固定；从预计算的第 14 轮继续。
  const words = new Array<number>(14).fill(0);
  words.push((data[0] << 16) | (data[1] << 8) | data[2]);
  words.push(((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0);
  for (let i = 16; i < 30; i++) {
    let value = GEC_SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) {
      value += i === 16 ? (sigma1(words[i - 2]) ^ 0x000b92c0) >>> 0 : sigma1(words[i - 2]);
    }
    if (i - 7 >= 14) value += words[i - 7];
    if (i - 15 >= 14) {
      value += i === 29 ? (sigma0(words[i - 15]) ^ 0x059c0b80) >>> 0 : sigma0(words[i - 15]);
    }
    words.push(value >>> 0);
  }
  words.push(
    (sigma1(words[28]) +
      words[23] +
      sigma0(words[15]) +
      words[14] +
      0xc9dc06a7 -
      SHA256_ROUND_CONSTANTS[14]) >>>
      0,
  );
  expandSha256Schedule(words);
  let state = sha256Rounds(GEC_SHA256_STATE, words, 14).map(
    (value, i) => (value + SHA256_INITIAL[i]) >>> 0,
  );

  const length = 57 + data.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64 - 64);
  padded.set(data.subarray(7));
  padded[data.length - 7] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, length * 8, false);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const block = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, false));
    expandSha256Schedule(block);
    state = sha256Rounds(state, block).map((value, i) => (value + state[i]) >>> 0);
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  state.forEach((value, i) => digestView.setUint32(i * 4, value, false));
  return digest;
}

function gecCs64(data: Uint8Array, digest: Uint8Array): Uint8Array {
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keys = [digestView.getUint32(0, true) | 1, digestView.getUint32(4, true) | 1];
  // Math.imul 保留 32 位乘法的低位，避免 JS 浮点乘法丢失整数精度。
  const factors = keys.map((key) => Math.imul(key, 0x82893933));
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => Math.imul(coefficient, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 8) * 8);
  padded.set(data, 1);
  const view = new DataView(padded.buffer);
  const rol16 = (value: number) => (value << 16) | (value >>> 16);
  for (let i = 0; i < padded.length / 4; i++) {
    const word = view.getUint32(i * 4, true);
    let term = Math.imul(word, keys[i % 2]);
    let offset = Math.imul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term += Math.imul(0xf2f90b1a, factors[0]);
      offset += 0x0b1a0000;
    }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  }
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let q = Math.imul(rol16((offsets[i] + x) >>> 0), 0x76f50f34);
    swapAcc = (swapAcc + Math.imul(rol16(q), 0xc3efea97) + q) >>> 0;
    q = Math.imul(rol16((offsets[i + 1] + y) >>> 0), 0x1881ce3c);
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (Math.imul(state, keys[0]) + x) >>> 0;
    for (const factor of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) {
      state = Math.imul(rol16(state), factor);
    }
    acc = (acc + state) >>> 0;
    state = (Math.imul(state, keys[1]) + y) >>> 0;
    for (const factor of [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69]) {
      state = Math.imul(rol16(state), factor);
    }
    acc = (acc + state) >>> 0;
  }
  const result = new Uint8Array(8);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, swapLast ^ state, true);
  resultView.setUint32(4, swapAcc ^ acc, true);
  return result;
}

function hexUpper(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function generateSecMsGec(): string {
  let ticks = BigInt(Math.floor(Date.now() / 1000));
  ticks += WIN_EPOCH_OFFSET;
  ticks -= ticks % 300n;
  ticks *= S_TO_NS / 100n;
  const data = new TextEncoder().encode(`${ticks}${EDGE_API_TOKEN}`);
  const digest = gecSha256(data);
  return `${hexUpper(gecCs64(data, digest))}-${hexUpper(digest)}`;
}

function generateMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function randomHex(len: number): string {
  const array = new Uint8Array(len);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── SSML Generation ──

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function genSSML(lang: string, text: string, voice: string, rate: number, pitch: number): string {
  const rateStr = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
  const pitchStr = `${pitch >= 1 ? "+" : ""}${Math.round((pitch - 1) * 50)}Hz`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rateStr}" pitch="${pitchStr}">${escapeXml(text)}</prosody></voice></speak>`;
}

// ── Message formatter ──

function genMessage(headers: Record<string, string>, content: string): string {
  let header = "";
  for (const key of Object.keys(headers)) {
    header += `${key}: ${headers[key]}\r\n`;
  }
  return `${header}\r\n${content}`;
}

// ── Edge TTS WebSocket Client (using IPlatformService) ──

export interface EdgeTTSPayload {
  text: string;
  voice: string;
  lang: string;
  rate: number;
  pitch: number;
}

function formatEdgeTTSError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeMessage =
      "message" in error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : null;
    if (maybeMessage) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

const edgeTtsAudioCache = new Map<string, ArrayBuffer>();
const edgeTtsInflightCache = new Map<string, Promise<ArrayBuffer>>();

function getEdgeTTSPayloadKey(payload: EdgeTTSPayload): string {
  return JSON.stringify([payload.voice, payload.lang, payload.rate, payload.pitch, payload.text]);
}

function cloneAudioBuffer(audioData: ArrayBuffer): ArrayBuffer {
  return audioData.slice(0);
}

function touchEdgeTTSAudioCache(key: string, audioData: ArrayBuffer) {
  if (edgeTtsAudioCache.has(key)) {
    edgeTtsAudioCache.delete(key);
  }
  edgeTtsAudioCache.set(key, audioData);

  while (edgeTtsAudioCache.size > EDGE_TTS_AUDIO_CACHE_LIMIT) {
    const oldestKey = edgeTtsAudioCache.keys().next().value;
    if (!oldestKey) break;
    edgeTtsAudioCache.delete(oldestKey);
  }
}

/**
 * Phase 1 spike: optional callbacks/overrides that let callers observe metadata
 * frames (WordBoundary / Bookmark) and inject custom SSML. Existing playback
 * code does not use these — see {@link fetchEdgeTTSAudioWithMetadata}.
 */
export interface EdgeTTSCoreOptions {
  /** Fired for each parsed metadata event (WordBoundary / Bookmark / SentenceBoundary). */
  onMetadata?: (event: EdgeTTSMetadataEvent) => void;
  /** Override the SSML sent to the server. Use to inject `<bookmark>` etc. */
  ssmlOverride?: string;
  /** Fired with raw text frames whose Path is neither audio.metadata nor turn.end. Diagnostics only. */
  onUnknownTextFrame?: (raw: string) => void;
  /** Toggle SentenceBoundary events (default false; current production behavior). */
  enableSentenceBoundary?: boolean;
}

/**
 * Core implementation: opens the WebSocket, sends config + SSML, accumulates
 * audio bytes, and (optionally) parses metadata text frames into events.
 *
 * The default behavior — no callbacks, no override — is identical to the
 * pre-Phase-1 implementation: only `Path:turn.end` and binary audio frames are
 * acted on; everything else is dropped.
 */
async function fetchEdgeTTSAudioCore(
  payload: EdgeTTSPayload,
  options: EdgeTTSCoreOptions = {},
): Promise<ArrayBuffer> {
  const platform = getPlatformService();

  const connectId = randomHex(16);
  const secMsGec = generateSecMsGec();

  const params = new URLSearchParams({
    ConnectionId: connectId,
    TrustedClientToken: EDGE_API_TOKEN,
    "Sec-MS-GEC": secMsGec,
    "Sec-MS-GEC-Version": `2-${CHROMIUM_FULL_VERSION}`,
  });
  const url = `${EDGE_SPEECH_URL}?${params.toString()}`;

  const headers: Record<string, string> = {
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    Cookie: `muid=${generateMuid()};`,
  };

  const date = new Date().toString();
  const ssml =
    options.ssmlOverride ??
    genSSML(payload.lang, payload.text, payload.voice, payload.rate, payload.pitch);

  const configMsg = genMessage(
    {
      "Content-Type": "application/json; charset=utf-8",
      Path: "speech.config",
      "X-Timestamp": date,
    },
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: options.enableSentenceBoundary ?? false,
              wordBoundaryEnabled: true,
            },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    }),
  );

  const ssmlMsg = genMessage(
    {
      "Content-Type": "application/ssml+xml",
      Path: "ssml",
      "X-RequestId": connectId,
      "X-Timestamp": date,
    },
    ssml,
  );

  return new Promise((resolve, reject) => {
    platform
      .createWebSocket(url, { headers })
      .then((ws) => {
        let audioData = new ArrayBuffer(0);
        let settled = false;
        // Capture diagnostic frames so error messages can include the
        // server's actual reason instead of a generic "no audio". The Edge
        // server emits Path:response (success/error JSON) and Path:turn.end
        // even when synthesis produces 0 bytes — usually with the error in
        // the response body.
        let lastResponseBody = "";

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            ws.close();
            reject(new Error("Edge TTS WebSocket timeout (30s)"));
          }
        }, 30_000);

        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          fn();
        };

        const buildNoAudioError = () => {
          const textPreview = ssml.length > 80 ? `${ssml.slice(0, 80)}…` : ssml;
          const responseInfo = lastResponseBody
            ? ` server response: ${lastResponseBody.slice(0, 200)}`
            : "";
          return new Error(`Edge TTS returned no audio.${responseInfo} ssml="${textPreview}"`);
        };

        ws.onMessage((data) => {
          try {
            if (typeof data === "string") {
              // Capture the response body for diagnostics — emitted by the
              // server before turn.end, success or failure. Cheap to parse:
              // a single substring + indexOf.
              const responseIdx = data.search(/Path:\s*response\b/i);
              if (responseIdx >= 0) {
                const sep = data.indexOf("\r\n\r\n", responseIdx);
                if (sep >= 0) lastResponseBody = data.slice(sep + 4).trim();
              }

              // Fast path for turn.end — preserves pre-Phase-1 behavior so this
              // check stays cheap when no metadata callback is registered.
              if (data.includes("Path:turn.end") || data.includes("Path: turn.end")) {
                ws.close();
                if (!audioData.byteLength) {
                  return settle(() => reject(buildNoAudioError()));
                }
                return settle(() => resolve(audioData));
              }

              // Phase 1: parse text frames so callers can observe WordBoundary /
              // Bookmark events. When no callbacks are set this is a no-op aside
              // from the parse itself, which is cheap (a string split + JSON.parse).
              if (options.onMetadata || options.onUnknownTextFrame) {
                const frame = parseEdgeTTSTextFrame(data);
                const path = frame?.path?.toLowerCase() ?? "";
                if (frame && path.startsWith("audio.metadata")) {
                  if (options.onMetadata) {
                    const events = parseEdgeTTSMetadataBody(frame.body);
                    for (const ev of events) options.onMetadata(ev);
                  }
                } else if (options.onUnknownTextFrame) {
                  options.onUnknownTextFrame(data);
                }
              }
            } else {
              const bytes = new Uint8Array(data);
              if (bytes.length < 2) return;
              const headerLength = (bytes[0] << 8) | bytes[1];
              if (bytes.length > headerLength + 2) {
                const newBody = bytes.slice(2 + headerLength);
                const merged = new Uint8Array(audioData.byteLength + newBody.byteLength);
                merged.set(new Uint8Array(audioData), 0);
                merged.set(newBody, audioData.byteLength);
                audioData = merged.buffer;
              }
            }
          } catch (err) {
            console.error("[Edge TTS] message handling error:", err);
          }
        });

        ws.onError((error) => {
          settle(() =>
            reject(
              new Error(
                `Edge TTS WebSocket error: ${formatEdgeTTSError(error)}${
                  lastResponseBody ? ` (last response: ${lastResponseBody.slice(0, 200)})` : ""
                }`,
              ),
            ),
          );
        });

        ws.onClose(() => {
          if (!audioData.byteLength) {
            settle(() =>
              reject(
                new Error(
                  `Edge TTS WebSocket closed without audio data${
                    lastResponseBody ? ` (last response: ${lastResponseBody.slice(0, 200)})` : ""
                  }`,
                ),
              ),
            );
          } else {
            settle(() => resolve(audioData));
          }
        });

        ws.send(configMsg);
        ws.send(ssmlMsg);
      })
      .catch((error) => {
        reject(new Error(`Edge TTS WebSocket error: ${formatEdgeTTSError(error)}`));
      });
  });
}

/**
 * Fetch audio from Edge TTS via IPlatformService.createWebSocket.
 * The platform service allows setting custom headers (User-Agent, Origin, Cookie)
 * that browser native WebSocket cannot set.
 * Returns the accumulated MP3 audio as an ArrayBuffer.
 *
 * This is the cache-eligible production path. Behavior matches pre-Phase-1.
 */
async function fetchEdgeTTSAudioUncached(payload: EdgeTTSPayload): Promise<ArrayBuffer> {
  return fetchEdgeTTSAudioCore(payload);
}

export async function fetchEdgeTTSAudio(payload: EdgeTTSPayload): Promise<ArrayBuffer> {
  const cacheKey = getEdgeTTSPayloadKey(payload);
  const cachedAudio = edgeTtsAudioCache.get(cacheKey);
  if (cachedAudio) {
    touchEdgeTTSAudioCache(cacheKey, cachedAudio);
    return cloneAudioBuffer(cachedAudio);
  }

  const inflight = edgeTtsInflightCache.get(cacheKey);
  if (inflight) {
    return cloneAudioBuffer(await inflight);
  }

  const request = fetchEdgeTTSAudioUncached(payload)
    .then((audioData) => {
      const cachedCopy = audioData.slice(0);
      touchEdgeTTSAudioCache(cacheKey, cachedCopy);
      return cachedCopy;
    })
    .finally(() => {
      edgeTtsInflightCache.delete(cacheKey);
    });

  edgeTtsInflightCache.set(cacheKey, request);
  return cloneAudioBuffer(await request);
}

// ── Phase 1 spike: SSML with bookmarks + metadata-aware fetch ──

/**
 * Build SSML where each text segment is preceded by a `<bookmark mark="..."/>`
 * element. Microsoft's SSML extension uses `<bookmark>` (not the standard
 * `<mark>`); the readaloud server emits a Bookmark metadata event as
 * synthesis crosses each one.
 *
 * Used by the Phase 1 spike to verify Edge TTS actually fires Bookmark events.
 * Once verified this becomes the basis for foliate.tts integration.
 */
export function genEdgeTTSBookmarkSSML(params: {
  lang: string;
  voice: string;
  rate: number;
  pitch: number;
  /** Each segment becomes `<bookmark mark="<name>"/><text>`. Order is preserved. */
  segments: { name: string; text: string }[];
}): string {
  const { lang, voice, rate, pitch, segments } = params;
  const rateStr = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
  const pitchStr = `${pitch >= 1 ? "+" : ""}${Math.round((pitch - 1) * 50)}Hz`;

  const inner = segments
    .map(({ name, text }) => {
      // Bookmark name must be a safe XML attribute value; SSML spec allows
      // any string, but we're conservative and reuse XML escaping.
      return `<bookmark mark="${escapeXml(name)}"/>${escapeXml(text)}`;
    })
    .join("");

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rateStr}" pitch="${pitchStr}">${inner}</prosody></voice></speak>`;
}

/**
 * Phase 1 entry point: fetch Edge TTS audio while observing metadata events.
 *
 * Bypasses the audio cache (otherwise we'd skip the WebSocket roundtrip and
 * miss every event). Designed for spikes and for the upcoming
 * `EdgeTTSPlayer.speakSSML` path; **not** wired into the production playback
 * pipeline yet.
 *
 * @param payload  - voice/lang/rate/pitch (text is ignored if `ssmlOverride` set)
 * @param options  - callbacks + optional SSML override
 */
export async function fetchEdgeTTSAudioWithMetadata(
  payload: EdgeTTSPayload,
  options: EdgeTTSCoreOptions = {},
): Promise<ArrayBuffer> {
  return fetchEdgeTTSAudioCore(payload, options);
}
