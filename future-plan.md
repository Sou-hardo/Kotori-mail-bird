# Future Plan: Local LLM and DeepSeek Hybrid

## Objective

Add a lightweight local language model to Kotori for private, low-cost email classification, summarization, and reply drafting while retaining DeepSeek as an optional fallback for complex requests.

The local inference service must:

- Run on CPU.
- Stay below 5 GB total RAM under the production configuration.
- Keep normal email processing local by default.
- Produce schema-constrained output that Kotori validates before storing or displaying.
- Preserve the existing human-review and never-send software architecture.

## Recommended model

Start with **Qwen3.5-2B Q4**, served through `llama.cpp`.

Expected deployment characteristics with an 8K context and one inference slot:

| Model | Estimated total RAM | Recommended use |
| --- | ---: | --- |
| Qwen3.5-2B Q4 | 2.5-3.5 GB | Primary classifier, summarizer, and reply generator |
| Qwen3.5-0.8B Q4 | 1-1.5 GB | Fast classification and simple replies on slower hardware |
| Gemma 3 1B QAT Q4 | 1-2 GB | Alternative for drafting and summarization |
| Phi-4 Mini 3.8B Q4 | Approximately 4-5+ GB | Higher-capability but borderline option |

Qwen3.5-2B is the preferred starting point because it has an Apache-2.0 license, multilingual support, and a better quality-to-memory balance than the sub-1B alternatives.

References:

- [Qwen3.5-2B model card](https://huggingface.co/Qwen/Qwen3.5-2B)
- [Qwen3.5-0.8B GGUF](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF)
- [Gemma 3 1B Q4](https://huggingface.co/google/gemma-3-1b-it-qat-q4_0-gguf)
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

Do not adopt an unverified third-party email fine-tune as the initial production model. Establish a baseline with an official instruction model and Kotori's own evaluation set first.

## Hybrid routing policy

Use the local model for:

- Classification of new threads.
- Short summaries and requested-action extraction.
- Low-risk reply drafts.
- Tone, length, identity, and closing transformations.
- Schema repair or retry when the first local output is invalid.

Use DeepSeek only when:

- The local model repeatedly returns invalid output.
- The request requires reasoning that fails the local quality checks.
- The compressed thread cannot fit the configured local context.
- The user explicitly opts into cloud-assisted generation.

DeepSeek must not automatically receive sensitive financial, legal, medical, credential, or similarly high-risk correspondence. Cloud fallback should be opt-in and should remove email addresses, signatures, identifiers, and irrelevant personal data before transmission.

Suggested routing flow:

```text
new email
   |
   v
local model: classify and summarize
   |
   +-- low risk and within context --> local reply
   |
   +-- invalid or complex ----------> redact unnecessary data
                                         |
                                         v
                              user permits cloud processing?
                                   |                 |
                                  yes                no
                                   |                 |
                                   v                 v
                               DeepSeek       local retry or
                                              manual drafting
```

LLM-generated confidence must not control safety decisions by itself. Financial commitments, legal terms, deadlines, attachments, sensitive information, and recipient checks must remain deterministic application rules.

## Inference runtime

Use `llama.cpp` and its OpenAI-compatible `/v1/chat/completions` API. It supports CPU inference, quantized GGUF models, JSON-schema-constrained generation, batching, and monitoring.

Initial production profile:

```bash
llama-server \
  --model /models/qwen3.5-2b-q4_k_m.gguf \
  --alias kotori-local \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 8192 \
  --parallel 1
```

The context limit and concurrency limit are part of the RAM budget. Do not use the model's maximum advertised context in production without measuring peak resident memory.

## Kotori integration architecture

The existing AI implementation already calls an OpenAI-style `/chat/completions` endpoint. Generalize it from a DeepSeek-specific client into a provider-neutral inference client.

The current Convex actions execute in Convex Cloud, so they cannot reach a model bound to `localhost` on the VPS. There are two possible integrations:

### Preferred: private VPS inference worker

1. Convex creates an AI processing job.
2. A persistent worker on the VPS securely claims the job.
3. The worker calls `llama-server` through the private Docker network.
4. It validates the model output against the required schema.
5. It completes or fails the Convex job with bounded retry behavior.
6. It invokes DeepSeek only when the routing policy permits it.

This design keeps the model port and raw email content off the public network.

### Alternative: authenticated inference gateway

Expose a narrowly scoped HTTPS inference route through the web application or Caddy and require a dedicated bearer credential or stronger service authentication. Convex actions can call this endpoint, which proxies to `llama-server` privately.

Do not expose the raw `llama-server` port to the internet.

## Context and workload controls

The current sync path schedules analysis for every imported or updated thread. A 180-day backfill could create thousands of CPU inference jobs. Change the workload before enabling local inference:

- Classify historical messages from subject and snippet only.
- Fully analyze only recent or actionable inbox messages.
- Summarize a thread in detail when the user opens it or when classification marks it actionable.
- Generate replies only on demand.
- Use the stored thread summary plus the most recent relevant messages instead of sending an entire long thread.
- Limit local input to approximately 4K-8K tokens initially.
- Run one generation at a time and use the existing queue for burst absorption.
- Pause or deprioritize backfill analysis when interactive reply jobs are waiting.

## Email specialization

Specialize the base model incrementally:

1. Define strict classification, summary, and reply JSON schemas.
2. Use separate prompts for classification and reply writing.
3. Retrieve three to five similar, user-approved sent replies as style examples.
4. Provide explicit identity, tone, length, closing, and prohibited-commitment fields.
5. Record whether drafts are approved, edited, or rejected without storing unnecessary prompt content in audit logs.
6. Consider a LoRA fine-tune only after prompt and retrieval baselines are measured.

Per-user retrieval is preferred over per-user fine-tuning. It adapts voice immediately, is easier to delete, and avoids maintaining a separate model for every customer.

A future global LoRA adapter should use approximately 2,000-5,000 curated, de-identified input/output pairs. Training can occur on rented GPU capacity; the merged and quantized GGUF model should still run on CPU. Customer email must not be used for training without affirmative consent and documented de-identification.

## Evaluation plan

Build a provider-neutral benchmark harness before selecting the final model.

### Evaluation set

Create 100-200 representative, sanitized email threads covering:

- Short and long threads.
- Action-required, waiting, FYI, newsletter, receipt, spam, and unknown categories.
- Different tones and identity profiles.
- Multiple recipients and attachments.
- Financial, legal, recruitment, complaint, sensitive-information, and deadline flags.
- English and the other languages expected from early customers.
- Prompt-injection attempts embedded in email content.

### Models to compare

- Qwen3.5-2B Q4.
- Qwen3.5-0.8B Q4.
- Gemma 3 1B QAT Q4.
- DeepSeek as the cloud quality baseline.

### Measurements

- Peak resident memory on the target VPS.
- Input processing and output generation speed.
- End-to-end latency for classification, summary, and reply tasks.
- Strict JSON and schema-validation success rate.
- Category precision, recall, and F1.
- Requested-action extraction accuracy.
- Hallucinated commitments, dates, recipients, and attachments.
- Draft approval rate and normalized edit distance.
- Prompt-injection resistance.
- Queue throughput and interactive-job latency during backfill.

Initial acceptance gates:

- Peak process memory below 5 GB with the configured context and concurrency.
- At least 99% schema-valid output after one bounded retry.
- At least 80% precision for `ACTION_REQUIRED` on the evaluation set.
- No automatic bypass of deterministic safety acknowledgements.
- Reply quality sufficient for at least 40% approval in a controlled user beta.
- Interactive reply latency acceptable on the actual production CPU.

## Rollout phases

### Phase 1: benchmark

- Create the sanitized evaluation corpus.
- Add provider-neutral inference interfaces.
- Run all candidate models on the target CPU.
- Select the model and context size from measured results.

### Phase 2: local classification

- Deploy `llama-server` privately.
- Route classification and short summaries locally.
- Keep reply generation on DeepSeek temporarily.
- Compare local and DeepSeek classifications in shadow mode without exposing local results to users.

### Phase 3: local replies

- Enable local replies for low-risk, short threads.
- Add style retrieval from approved sent mail.
- Measure approval rate, edit distance, latency, and invalid-output retries.

### Phase 4: optional cloud fallback

- Add an explicit cloud-assist preference and per-request disclosure.
- Redact inputs before fallback.
- Record which provider handled each job without logging raw email bodies.
- Never make sensitive correspondence automatically eligible for cloud fallback.

### Phase 5: specialization

- Curate consented and de-identified examples.
- Train and evaluate a LoRA adapter only if it materially improves approval rate.
- Re-quantize and repeat the complete safety and memory benchmark before rollout.

## Recommended initial decision

Proceed with Qwen3.5-2B Q4, an 8K context, one inference slot, and a private VPS worker. Use the local model for classification, summaries, and ordinary drafts. Retain DeepSeek as an explicit, redacted fallback rather than the default processor.

No model choice should be finalized until it passes the benchmark on the actual production CPU and remains below the 5 GB peak-memory requirement.
