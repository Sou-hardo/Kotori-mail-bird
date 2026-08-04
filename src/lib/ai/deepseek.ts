import { z } from "zod";
import { sanitizeJsonStrings } from "@/lib/ai/sanitize";

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
});

export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

export async function deepSeekJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new AiResponseError("DEEPSEEK_API_KEY is not set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const response = await fetcher(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok)
    throw new AiResponseError(`DeepSeek returned HTTP ${response.status}`);
  let envelope: z.infer<typeof responseSchema>;
  try {
    envelope = responseSchema.parse(await response.json());
  } catch {
    throw new AiResponseError(
      "DeepSeek returned a malformed response envelope",
    );
  }
  const choice = envelope.choices[0];
  if (!choice) throw new AiResponseError("DeepSeek returned no choices");
  if (choice.finish_reason === "length")
    throw new AiResponseError("DeepSeek response was truncated");
  const content = choice.message.content?.trim();
  if (!content)
    throw new AiResponseError("DeepSeek returned an empty response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiResponseError("DeepSeek returned malformed JSON");
  }
  const validated = schema.safeParse(sanitizeJsonStrings(parsed));
  if (!validated.success)
    throw new AiResponseError(
      `DeepSeek JSON failed schema validation: ${validated.error.message}`,
    );
  return validated.data;
}
