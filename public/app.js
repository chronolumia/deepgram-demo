const RATE_PER_MINUTE_USD = 0.0048 + 0.002 + 0.002 + 0.0013;
const PROJECTED_MONTHLY_HOURS = 10000;

const runBtn = document.getElementById("run-btn");
const statusEl = document.getElementById("status");
const costEl = document.getElementById("cost");
const tableEl = document.getElementById("results-table");
const bodyEl = document.getElementById("results-body");
const emptyEl = document.getElementById("empty");
const validationNoteEl = document.getElementById("validation-note");

const speakerLabels = { agent: "Agent", customer: "Customer", unknown: "Unknown speaker" };

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  if (attrs) Object.assign(node, attrs);
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderCostProjection(records) {
  let totalSec = 0;
  for (const r of records) {
    totalSec += r.source?.durationSec ?? 0;
  }
  const totalMinutes = totalSec / 60;
  const thisRunCost = totalMinutes * RATE_PER_MINUTE_USD;
  const monthlyMinutes = PROJECTED_MONTHLY_HOURS * 60;
  const monthlyCost = monthlyMinutes * RATE_PER_MINUTE_USD;

  costEl.replaceChildren(
    el("div", null, `This run: ${totalSec.toFixed(1)}s of audio processed → ≈ $${thisRunCost.toFixed(4)}.`),
    el(
      "div",
      { style: "margin-top: 4px;" },
      `At DataVoice's stated volume (${PROJECTED_MONTHLY_HOURS.toLocaleString()} h/month), the same configuration ` +
        `(nova-3 + diarize + redact + keyterm) projects to ≈ $${monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/month, pay-as-you-go.`
    )
  );
  costEl.style.display = "block";
}

function buildTranscriptBlock(record) {
  const block = el("div", { className: "detail-block" });
  block.append(el("div", { className: "detail-label" }, "Redacted transcript"));

  const segments = record.transcript?.segments ?? [];
  if (segments.length) {
    for (const segment of segments) {
      const line = el("div", { className: "speaker-line" });
      line.append(
        el("span", { className: "speaker-tag" }, speakerLabels[segment.speaker] ?? segment.speaker),
        el("span", null, segment.text)
      );
      block.append(line);
    }
  } else {
    block.append(el("div", { className: "detail-text" }, record.transcript?.redactedText || "(empty)"));
  }

  return block;
}

function buildDetailCell(record) {
  const cell = el("td", { colSpan: 6 });

  cell.append(buildTranscriptBlock(record));

  const meta = [`engine: ${record.processing?.engine ?? "—"}`, `model: ${record.processing?.model ?? "—"}`];
  if (record.validation) meta.push(`baseline: ${record.validation.baselineLabel}`);
  cell.append(el("div", { className: "meta-line", style: "margin-top: 12px;" }, meta.join(" · ")));

  if (record.intelligence?.summary) {
    const summaryBlock = el("div", { className: "detail-block" });
    summaryBlock.append(
      el("div", { className: "detail-label" }, "Summary"),
      el("div", { className: "detail-text" }, record.intelligence.summary)
    );
    cell.append(summaryBlock);
  }

  if (record.intelligence?.topics?.length) {
    const topicsBlock = el("div", { className: "detail-block" });
    const topicsWrap = el("div", { className: "topics" });
    for (const topic of record.intelligence.topics) topicsWrap.append(el("span", null, topic));
    topicsBlock.append(el("div", { className: "detail-label" }, "Topics"), topicsWrap);
    cell.append(topicsBlock);
  }

  if (record.error) {
    const errorBlock = el("div", { className: "detail-block" });
    errorBlock.append(
      el("div", { className: "detail-label" }, "Error"),
      el("div", { className: "detail-text" }, record.error)
    );
    cell.append(errorBlock);
  }

  return cell;
}

function renderRow(record) {
  const row = el("tr", { className: "call-row" });
  const ok = !record.error;

  row.append(
    el("td", null, record.callId),
    el("td", { className: "num" }, formatDuration(record.source?.durationSec ?? 0)),
    (() => {
      const cell = el("td");
      cell.append(el("span", { className: `pill ${ok ? "ok" : "err"}` }, ok ? "ok" : "error"));
      return cell;
    })(),
    (() => {
      const cell = el("td", { className: "num" });
      if (record.validation) {
        cell.append(
          el("div", null, `${(record.validation.wer * 100).toFixed(1)}%`),
          el("div", { className: "wer-baseline" }, `vs. ${record.validation.baselineLabel}`)
        );
      } else {
        cell.textContent = "—";
      }
      return cell;
    })(),
    el(
      "td",
      { className: "num" },
      record.validation ? `${(record.validation.domainTermRecall * 100).toFixed(0)}%` : "—"
    ),
    el("td", null, record.intelligence?.summary ? record.intelligence.summary.slice(0, 80) + "…" : "—")
  );

  const detailRow = el("tr", { className: "detail-row" });
  detailRow.append(buildDetailCell(record));

  row.addEventListener("click", () => detailRow.classList.toggle("open"));

  return [row, detailRow];
}

function renderResults(records) {
  bodyEl.replaceChildren();

  if (!records.length) {
    tableEl.style.display = "none";
    costEl.style.display = "none";
    validationNoteEl.style.display = "none";
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";
  tableEl.style.display = "table";

  for (const record of records) {
    const [row, detailRow] = renderRow(record);
    bodyEl.append(row, detailRow);
  }

  renderCostProjection(records);

  validationNoteEl.style.display = records.some((r) => r.validation) ? "block" : "none";
  validationNoteEl.textContent =
    "WER vs. baseline measures disagreement with a weaker Deepgram model, not verified accuracy — " +
    "see VALIDATION.md for what it's actually good for (drift detection, human-review triage).";
}

async function runPipeline() {
  runBtn.disabled = true;
  statusEl.textContent = "running…";
  try {
    const res = await fetch("/api/run", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    renderResults(data.records);
    const errorCount = data.records.filter((r) => r.error).length;
    statusEl.textContent = `done — ${data.count} calls, ${errorCount} errors`;
  } catch (err) {
    statusEl.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    runBtn.disabled = false;
  }
}

async function loadLatestRun() {
  try {
    const res = await fetch("/api/runs/latest");
    const data = await res.json();
    if (data.count > 0) {
      renderResults(data.records);
      statusEl.textContent = `showing last run — ${data.count} calls`;
    }
  } catch {
    // Keep the idle empty state if the server isn't ready yet.
  }
}

runBtn.addEventListener("click", runPipeline);
loadLatestRun();
