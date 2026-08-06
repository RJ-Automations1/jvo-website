/*
 * Website chatbot — POST /api/chat
 *
 * Answers visitor questions from the JVO capability overview in jvoKnowledge.ts.
 * The model is given no tools: it can't look anything up, book anything, or reach
 * any other part of this server. Every answer comes from the system prompt, which
 * is why that file is the thing to edit when the price list changes.
 *
 * The API key lives only in ANTHROPIC_API_KEY on the server — never in the frontend
 * bundle. If it isn't set, the endpoint degrades to a friendly "call us" reply
 * rather than erroring, so an unconfigured deploy still looks intentional.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { JVO_SYSTEM_PROMPT } from "./jvoKnowledge.js";

const CHAT_MODEL = process.env.CHAT_MODEL || "claude-opus-5";

const CONTACT = "email jonesborovirtualoffice@gmail.com or call 678-519-4723";
const FALLBACK = `Sorry — I'm having trouble right now. Please ${CONTACT} and the JVO team will help you directly.`;
const NOT_CONFIGURED = `Our live assistant isn't set up just yet. Please ${CONTACT} and the JVO team will be happy to help!`;

/* Transcript limits. A visitor chat is small; anything past this is abuse, not use. */
const MAX_TURNS = 12;
const MAX_CHARS_PER_MESSAGE = 2000;

/*
 * Per-IP rate limit. This endpoint spends money on every call, so an unthrottled
 * public POST is a billing hole, not just a load concern. In-memory is enough:
 * one instance serves the site, and a restart only forgives the current window.
 */
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const hits = new Map<string, { count: number; resetAt: number }>();

function overRateLimit(ip: string, now: number): boolean {
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic sweep so the map can't grow without bound.
    if (hits.size > 5000) {
      hits.forEach((value, key) => {
        if (now >= value.resetAt) hits.delete(key);
      });
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

type Turn = { role: "user" | "assistant"; content: string };

export function mountChat(app: Express) {
  app.post("/api/chat", express.json({ limit: "64kb" }), async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (overRateLimit(ip, Date.now())) {
      return res.status(429).json({
        error: "rate_limited",
        reply: `You're sending messages faster than I can answer. Give it a moment, or ${CONTACT}.`,
      });
    }

    // Keep only well-formed turns, and cap both message length and history depth.
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages: Turn[] = raw
      .filter(
        (m: unknown): m is Turn =>
          !!m &&
          typeof m === "object" &&
          ((m as Turn).role === "user" || (m as Turn).role === "assistant") &&
          typeof (m as Turn).content === "string" &&
          (m as Turn).content.trim() !== ""
      )
      .slice(-MAX_TURNS)
      .map((m: Turn) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_MESSAGE) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ error: "A user message is required." });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({ reply: NOT_CONFIGURED });
    }

    try {
      const message = await getClient().messages.create({
        model: CHAT_MODEL,
        // Headroom for adaptive thinking plus the answer — max_tokens caps both
        // together, so a tight cap here truncates replies mid-sentence.
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: [
          {
            type: "text",
            text: JVO_SYSTEM_PROMPT,
            // Same prompt on every request — cached reads cost ~a tenth of full price.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      });

      if (message.stop_reason === "refusal") {
        return res.json({
          reply: `I can't help with that one, but I'm happy to answer anything about JVO memberships, mail, or space. For anything else, ${CONTACT}.`,
        });
      }

      const reply = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return res.json({ reply: reply || "Sorry, I didn't catch that — could you rephrase?" });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        console.error("[/api/chat] upstream rate limit");
        return res.status(429).json({
          error: "rate_limited",
          reply: `We're getting a lot of questions right now. Try again in a moment, or ${CONTACT}.`,
        });
      }
      console.error("[/api/chat] failed:", err instanceof Error ? err.message : err);
      return res.status(502).json({ error: "chat_unavailable", reply: FALLBACK });
    }
  });
}
