const Anthropic = require("@anthropic-ai/sdk");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const PROMPT = `Kamu membaca foto SCORECARD GOLF untuk SATU pemain (18 hole).
Kembalikan HANYA JSON valid tanpa teks lain, tanpa markdown, dengan bentuk:
{"pars":[18 angka],"scores":[18 angka],"low_confidence_holes":[nomor hole 1-18 yang kamu ragu]}
Aturan:
- "pars" = angka par tiap hole sesuai yang tertulis di kartu (umumnya 3-5).
- "scores" = skor pukulan pemain tiap hole.
- Jika hanya 9 hole terbaca, isi sisanya dengan angka yang masuk akal namun masukkan nomornya ke low_confidence_holes.
- Jika satu sel tidak terbaca jelas, tebak terbaik DAN masukkan nomor hole-nya ke low_confidence_holes.
- pars dan scores HARUS tepat 18 angka.`;

async function ocrScorecard(base64, mediaType) {
  if (!client) throw new Error("ANTHROPIC_API_KEY belum di-set di server");
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
        { type: "text", text: PROMPT },
      ],
    }],
  });
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("OCR tidak mengembalikan JSON");
  const data = JSON.parse(m[0]);
  const fix = (arr) => {
    const a = Array.isArray(arr) ? arr.slice(0, 18).map((n) => Math.max(1, Math.min(15, parseInt(n) || 0))) : [];
    while (a.length < 18) a.push(0);
    return a;
  };
  return {
    parVector: fix(data.pars),
    scoreVector: fix(data.scores),
    lowConfidenceHoles: Array.isArray(data.low_confidence_holes) ? data.low_confidence_holes.map(Number).filter((n) => n >= 1 && n <= 18) : [],
    raw: data,
  };
}
module.exports = { ocrScorecard };
