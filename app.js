const defaultTemplates = [""];
const defaultJudgeTemplate = "";
// Real requests are sent through the server-side proxy configured by Streamlit.
const fixedTechEndpoint = "";
const fixedXApiKey = "";
const maxConcurrentTasks = 6;
const polishChunkSize = 60;

let state = {
  templates: [...defaultTemplates],
  judgeTemplate: defaultJudgeTemplate,
  files: [],
  selectedFileId: null,
  uploadedFileName: "",
  polishBatchRunning: false,
  checkBatchRunning: false,
};

const els = {
  templateBar: document.getElementById("templateBar"),
  addTemplateBtn: document.getElementById("addTemplateBtn"),
  judgeTemplateInput: document.getElementById("judgeTemplateInput"),
  batchPolishBtn: document.getElementById("batchPolishBtn"),
  batchCheckBtn: document.getElementById("batchCheckBtn"),
  exportBtn: document.getElementById("exportBtn"),
  mergedExportBtn: document.getElementById("mergedExportBtn"),
  conclusionDownloadBtn: document.getElementById("conclusionDownloadBtn"),
  clearBtn: document.getElementById("clearBtn"),
  fileInput: document.getElementById("fileInput"),
  selectAllInput: document.getElementById("selectAllInput"),
  fileMeta: document.getElementById("fileMeta"),
  fileList: document.getElementById("fileList"),
  originalRows: document.getElementById("originalRows"),
  originalView: document.getElementById("originalView"),
  copyOriginalBtn: document.getElementById("copyOriginalBtn"),
  polishResults: document.getElementById("polishResults"),
  qualityResults: document.getElementById("qualityResults"),
  winnerText: document.getElementById("winnerText"),
  scoreTable: document.getElementById("scoreTable"),
  toast: document.getElementById("toast"),
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function parseUploadedPayload(raw) {
  const outer = JSON.parse(raw);
  if (!Array.isArray(outer)) {
    throw new Error("上传文件外层必须是数组。");
  }

  return outer.map((item, index) => {
    try {
      const parsed = typeof item === "string" ? JSON.parse(item) : item;
      if (!Array.isArray(parsed)) {
        throw new Error("小文件不是字幕数组。");
      }
      const normalized = parsed.map((row, rowIndex) => {
        if (!row || !Object.prototype.hasOwnProperty.call(row, "s") || !Object.prototype.hasOwnProperty.call(row, "t")) {
          throw new Error(`第 ${rowIndex + 1} 行缺少 s 或 t 字段。`);
        }
        return { s: row.s, t: String(row.t ?? "") };
      });
      return createFileRecord(index, normalized, null);
    } catch (error) {
      return createFileRecord(index, [], error.message || "小文件解析失败。");
    }
  });
}

function createFileRecord(index, subtitles, parseError) {
  return {
    id: `file-${index + 1}`,
    index: index + 1,
    checked: true,
    subtitles,
    parseError,
    polishStatus: parseError ? "blocked" : "idle",
    checkStatus: "idle",
    structureStatus: "unchecked",
    polish: {},
    quality: {},
  };
}

function selectFile(fileId) {
  state.selectedFileId = fileId;
  render();
}

function getSelectedFile() {
  return state.files.find((file) => file.id === state.selectedFileId) || null;
}

function selectedFiles() {
  return state.files.filter((file) => file.checked && !file.parseError);
}

function baseFileName(name) {
  return (name || "subtitle_polish_demo")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "subtitle_polish_demo";
}

function render() {
  renderTemplates();
  renderFiles();
  renderMain();
  renderSummary();
}

function renderTemplates() {
  els.templateBar.innerHTML = "";
  const averages = calculateTemplateAverages();
  els.batchPolishBtn.disabled = state.polishBatchRunning;
  els.batchPolishBtn.title = "按填写的真实字幕润色模板 ID 执行后台润色";
  els.batchCheckBtn.disabled = state.checkBatchRunning;
  els.batchCheckBtn.title = "按填写的真实质检模板 ID 执行后台质检";

  state.templates.forEach((templateId, index) => {
    const chip = document.createElement("div");
    chip.className = "template-chip";

    const avg = averages.get(templateId);
    const avgBadge = document.createElement("span");
    avgBadge.className = "avg-badge";
    avgBadge.textContent = `平均分 ${avg == null ? "--" : Math.round(avg)}`;

    const label = document.createElement("span");
    label.textContent = "字幕润色模板ID";

    const input = document.createElement("input");
    input.value = templateId;
    input.placeholder = "填写真实字幕润色模板ID";
    input.dataset.index = index;
    input.addEventListener("change", () => renameTemplate(index, input.value.trim()));

    const remove = document.createElement("button");
    remove.className = "remove-template";
    remove.title = "删除字幕润色模板";
    remove.textContent = "×";
    remove.disabled = state.templates.length === 1;
    remove.addEventListener("click", () => removeTemplate(index));

    chip.append(avgBadge, label, input, remove);
    els.templateBar.appendChild(chip);
  });

  els.judgeTemplateInput.value = state.judgeTemplate;
}

function renderFiles() {
  els.fileList.innerHTML = "";
  els.fileList.classList.toggle("empty", state.files.length === 0);
  els.fileMeta.textContent = state.files.length ? `文件 ${state.uploadedFileName || "--"}，条目数 ${state.files.length}` : "未上传文件";

  if (!state.files.length) {
    els.fileList.innerHTML = '<div class="empty-state">请选择字幕 JSON 文件</div>';
    els.selectAllInput.checked = false;
    return;
  }

  els.selectAllInput.checked = state.files.every((file) => file.checked);

  state.files.forEach((file) => {
    const criticalTotal = fileCriticalErrorCount(file);
    const card = document.createElement("article");
    card.className = `file-card ${file.id === state.selectedFileId ? "active" : ""} ${criticalTotal > 0 ? "has-critical" : ""}`.trim();
    card.title = "点击查看该小文件的原文、润色和质检结果";
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      selectFile(file.id);
    });

    const head = document.createElement("div");
    head.className = "file-card-head";

    const title = document.createElement("label");
    title.className = "file-title";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = file.checked;
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      file.checked = checkbox.checked;
      state.selectedFileId = file.id;
      render();
    });

    const openBtn = document.createElement("button");
    openBtn.innerHTML = `#${file.index}${file.id === state.selectedFileId ? '<span class="view-hint">正在查看</span>' : ""}`;
    openBtn.addEventListener("click", () => {
      selectFile(file.id);
    });

    title.append(checkbox, openBtn);
    head.append(title, statusTag(file.parseError ? "解析异常" : `${file.subtitles.length} 行`, file.parseError ? "error" : ""));

    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = file.parseError ? file.parseError : `字幕原文行数：${file.subtitles.length}`;

    const actions = document.createElement("div");
    actions.className = "file-actions";

    const polishBtn = document.createElement("button");
    polishBtn.className = "small-btn";
    polishBtn.textContent = file.polishStatus === "success" ? "重新润色" : "润色";
    polishBtn.disabled = Boolean(file.parseError) || file.polishStatus === "running";
    polishBtn.title = "按当前字幕润色模板 ID 执行后台润色";
    polishBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedFileId = file.id;
      runPolishForFiles([file]);
    });

    const checkBtn = document.createElement("button");
    checkBtn.className = "small-btn";
    checkBtn.textContent = file.checkStatus === "success" ? "重新质检" : "质检";
    checkBtn.disabled = !canCheck(file) || file.checkStatus === "running";
    checkBtn.title = "按当前质检模板 ID 执行后台质检";
    checkBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedFileId = file.id;
      runCheckForFiles([file]);
    });

    actions.append(polishBtn, checkBtn);

    const status = document.createElement("div");
    status.className = "status-row";
    status.append(
      statusTag(polishStatusText(file.polishStatus), statusClass(file.polishStatus)),
      statusTag(checkStatusText(file.checkStatus), statusClass(file.checkStatus)),
      statusTag(structureStatusText(file.structureStatus), structureClass(file.structureStatus)),
    );
    if (criticalTotal > 0) {
      const criticalTag = statusTag(`严重错误合计 ${criticalTotal}`, "error");
      criticalTag.title = buildFileCriticalErrorTitle(file);
      status.append(criticalTag);
    }

    card.append(head, meta, actions, status);
    els.fileList.appendChild(card);
  });
}

function renderMain() {
  const file = getSelectedFile();
  if (!file) {
    els.originalRows.textContent = "行数 --";
    els.originalView.textContent = "上传文件后显示字幕原文";
    els.polishResults.innerHTML = '<div class="empty-state">润色后显示各模板结果</div>';
    els.qualityResults.innerHTML = '<div class="empty-state">质检后显示评分与问题</div>';
    return;
  }

  els.originalRows.textContent = `行数 ${file.subtitles.length}`;
  els.originalView.textContent = file.parseError ? file.parseError : pretty(file.subtitles);
  renderPolishResults(file);
  renderQualityResults(file);
}

function renderPolishResults(file) {
  els.polishResults.innerHTML = "";
  let hasAny = false;

  state.templates.forEach((templateId) => {
    const result = file.polish[templateId];
    if (result) hasAny = true;
    const card = resultCard(
      templateId || "未填写润色模板ID",
      result?.status || "idle",
      result?.status === "success" ? `行数 ${result.output.length}，${result.structureOk ? "结构正常" : "结构异常"}` : "等待润色",
      () => runSingleTemplatePolish(file, templateId),
      false,
      "按当前字幕润色模板 ID 执行后台润色",
      result?.taskId,
    );
    const body = card.querySelector(".card-body");
    if (!result) {
      body.append(emptySmall("当前模板尚未润色。"));
    } else if (result.status === "failed") {
      body.append(statusTag(result.error || "润色失败", "error"));
    } else if (result.status === "running") {
      body.append(statusTag("润色中", "warn"));
    } else {
      const effectiveness = analyzePolishEffectiveness(file.subtitles, result.output);
      const statusLine = document.createElement("div");
      statusLine.className = "inline-status-line";
      statusLine.append(
        statusTag(result.structureOk ? "润色结构正常" : "润色结构异常", result.structureOk ? "success" : "error"),
        statusTag(`有效修改 ${effectiveness.changedRows}/${effectiveness.totalRows} 行`, effectiveness.changedRows ? "success" : "warn"),
      );
      if (result.autoRetried) {
        statusLine.append(statusTag("已自动重试", "warn"));
      }
      if (effectiveness.asrCandidatesTotal) {
        statusLine.append(statusTag(`ASR候选修复 ${effectiveness.asrCandidatesFixed}/${effectiveness.asrCandidatesTotal}`, effectiveness.asrCandidatesFixed ? "success" : "warn"));
      }
      if (!effectiveness.changedRows) {
        statusLine.append(statusTag("润色输出与原文一致，请确认模板提示词是否生效", "warn"));
      } else if (effectiveness.asrCandidatesTotal && !effectiveness.asrCandidatesFixed) {
        statusLine.append(statusTag("检测到ASR候选，但未看到对应修复", "warn"));
      }
      body.append(statusLine);
      body.append(codeBlock(result.output));
    }
    els.polishResults.appendChild(card);
  });

  if (!hasAny && !state.templates.length) {
    els.polishResults.innerHTML = '<div class="empty-state">请先添加字幕润色模板</div>';
  }
}

function renderQualityResults(file) {
  els.qualityResults.innerHTML = "";
  let hasAny = false;
  const fileSimilarity = analyzeFilePolishSimilarity(file);

  state.templates.forEach((templateId) => {
    const result = file.quality[templateId];
    if (result) hasAny = true;
    const card = resultCard(
      templateId || "未填写润色模板ID",
      result?.status || "idle",
      result?.status === "success" ? `质检分 ${result.report.total_score ?? "--"}` : `等待质检 / 质检模板 ${state.judgeTemplate || "未填写"}`,
      () => runSingleTemplateCheck(file, templateId),
      false,
      "按当前质检模板 ID 执行后台质检",
      result?.taskId,
    );
    const body = card.querySelector(".card-body");

    if (!result) {
      body.append(emptySmall("当前模板尚未质检。"));
    } else if (result.status === "failed") {
      body.append(statusTag(result.error || "质检失败", "error"));
      if (result.report) body.append(codeBlock(result.report));
    } else if (result.status === "running") {
      body.append(statusTag("质检中", "warn"));
    } else {
      const report = result.report;
      const statusLine = document.createElement("div");
      statusLine.className = "inline-status-line";
      statusLine.append(statusTag(`单文件建议：${decisionText(report.production_decision)}`, decisionClass(report.production_decision)));
      if (result.autoRetried) {
        statusLine.append(statusTag("已自动重试", "warn"));
      }
      if (report.score_parse_error) {
        statusLine.append(statusTag(report.score_parse_error, "warn"));
      }
      body.append(statusLine);
      body.append(metricRow(report.subscores));
      if (fileSimilarity.isComparable && fileSimilarity.isClose) {
        const similarityLine = document.createElement("div");
        similarityLine.className = "inline-status-line";
        similarityLine.append(statusTag(fileSimilarity.message, "warn"));
        body.append(similarityLine);
      }
      body.append(criticalIssuePanel(report));
      body.append(issueList(report.weaknesses));
      body.append(codeBlock(report));
    }
    els.qualityResults.appendChild(card);
  });

  if (!hasAny && !state.templates.length) {
    els.qualityResults.innerHTML = '<div class="empty-state">请先添加字幕润色模板</div>';
  }
}

function renderSummary() {
  const files = selectedFiles();
  const rankings = calculateRankings(files);
  const similaritySummary = analyzeSelectedPolishSimilarity(files);
  els.scoreTable.innerHTML = "";

  if (!rankings.length) {
    els.winnerText.textContent = state.files.length ? (files.length ? `当前已勾选 ${files.length} 个文件，暂无已完成质检结果。` : "") : "";
    els.scoreTable.innerHTML = state.files.length ? '<div class="empty-state">暂无平均分</div>' : "";
    return;
  }

  const aggregateDecision = buildAggregateDecision(files, rankings, similaritySummary);
  rankings.forEach((item) => {
    const cell = document.createElement("div");
    cell.className = "score-cell";
    cell.innerHTML = `<strong>${escapeHtml(item.templateId)}</strong><span>平均分 ${Math.round(item.avgScore)} / 赢${item.pairwiseWins || 0} 平${item.pairwiseTies || 0} 输${item.pairwiseLosses || 0} / 严重错误 ${item.criticalErrors}</span>`;
    els.scoreTable.appendChild(cell);
  });

  els.winnerText.textContent = aggregateDecision.text;
}

function buildCoverageText(files, rankings) {
  const selectedCount = files.length;
  const completedCount = rankings.length ? Math.max(...rankings.map((item) => item.reportsCount || 0), 0) : 0;
  return `基于当前勾选的 ${selectedCount} 个文件汇总，已完成质检 ${completedCount}/${selectedCount}。`;
}

function isRankingClose(a, b) {
  const scoreGap = Math.abs(a.avgScore - b.avgScore);
  const singleFileOrSparse = Math.max(a.reportsCount || 0, b.reportsCount || 0) <= 1;
  const criticalClose = Math.abs(a.criticalErrors - b.criticalErrors) <= 0;
  const structureClose = Math.abs(a.structureErrors - b.structureErrors) <= 0;
  const semanticClose = Math.abs(a.semanticErrors - b.semanticErrors) <= 1;
  const asrClose = Math.abs((a.asrErrors || 0) - (b.asrErrors || 0)) <= 1;
  const termClose = Math.abs(a.terminologyErrors - b.terminologyErrors) <= 1;
  const errorsClose = criticalClose && structureClose && semanticClose && asrClose && termClose;
  const scoreClose = scoreGap < 3 || (singleFileOrSparse && scoreGap <= 5) || (errorsClose && scoreGap <= 5);
  return scoreClose && errorsClose;
}

function buildAggregateDecision(files, rankings, similaritySummary) {
  if (!rankings.length) {
    return { text: `结论：还不能判断。当前已勾选 ${files.length} 个文件，但还没有可用的质检分。` };
  }

  const pairwise = buildPairwiseEvaluations(files);
  applyPairwiseStatsToRankings(rankings, pairwise);
  rankings.sort(compareDisplayRanking);

  const finalTop = rankings[0];
  const finalSecond = rankings[1];
  const decision = classifyAggregateRecommendation(files, rankings, pairwise, similaritySummary, finalTop, finalSecond);
  const basisText = buildPlainConclusionBasis(files, rankings, pairwise, similaritySummary, finalTop, finalSecond, decision);
  const topLabel = displayTemplateId(finalTop.templateId);
  const secondLabel = finalSecond ? displayTemplateId(finalSecond.templateId) : "";
  const tiedTop = finalSecond ? getTopScoreTies(rankings) : [];

  if (!finalSecond) {
    return {
      text: `结论：暂不能做模型对比。现在只有 ${topLabel} 有有效质检结果，需要至少两个模型都有结果后再判断。${basisText}`,
    };
  }

  if (tiedTop.length > 1) {
    return {
      text: `结论：${tiedTop.map((item) => displayTemplateId(item.templateId)).join(" 和 ")} 当前打平，暂时不用强行二选一。${basisText}`,
    };
  }

  if (decision.level === "auto") return { text: `结论：建议选择 ${topLabel}。${basisText}` };
  if (decision.level === "low_confidence") return { text: `结论：优先考虑 ${topLabel}，但建议再抽查几条后定。${basisText}` };
  if (decision.level === "review") return { text: `结论：暂时不能直接定模型。${topLabel} 目前排第一，但结果里还有明显风险，建议确认问题样本后再决定。${basisText}` };
  return { text: `结论：暂时不能直接定模型。${topLabel} 和 ${secondLabel} 差距不稳定，建议继续补样本后再选。${basisText}` };
}

function getTopScoreTies(rankings) {
  if (!rankings.length) return [];
  const topScore = Math.round(rankings[0].avgScore || 0);
  return rankings.filter((item) => Math.round(item.avgScore || 0) === topScore);
}

function classifyAggregateRecommendation(files, rankings, pairwise, similaritySummary, top, second) {
  if (!top) return { level: "none", reasons: ["暂无有效结果"] };
  if (!second) return { level: "review", reasons: ["只有一个模型有结果，无法对比"] };

  const selectedCount = files.length;
  const completedCount = rankings.length ? Math.max(...rankings.map((item) => item.reportsCount || 0), 0) : 0;
  const coverageOk = selectedCount > 0 && completedCount === selectedCount;
  const scoreGap = (top.avgScore || 0) - (second.avgScore || 0);
  const effectiveWinGap = (top.effectiveWins || 0) - (second.effectiveWins || 0);
  const hardRisk = (top.criticalErrors || 0) > 0 || (top.structureErrors || 0) > 0 || top.productionDecision === "needs_review";
  const notRecommended = top.productionDecision === "not_recommended";
  const backupOnly = top.productionDecision === "backup";
  const close = !hasClearLead(top, second, pairwise) || isRankingClose(top, second);
  const lowDistinguish = similaritySummary.comparableCount > 0 && similaritySummary.closeCount / similaritySummary.comparableCount >= 0.5;
  const reasons = [];

  if (!coverageOk) reasons.push(`还有 ${Math.max(0, selectedCount - completedCount)} 个已选文件没跑完质检`);
  if (notRecommended) reasons.push("当前第一名也被质检判为不推荐");
  if (backupOnly) reasons.push("当前第一名还不是特别稳");
  if (top.productionDecision === "needs_review") reasons.push("当前第一名有些样本需要确认后再用");
  if ((top.criticalErrors || 0) > 0) reasons.push(`当前第一名还有严重错误 ${top.criticalErrors} 个`);
  if ((top.structureErrors || 0) > 0) reasons.push(`当前第一名还有结构硬错误 ${top.structureErrors} 个`);
  if (close) reasons.push(`前两名差距不够大：平均分差 ${formatSignedNumber(scoreGap)}，胜负结果还不够稳定`);
  if (lowDistinguish) reasons.push(`两个模型差距小的样本较多：${similaritySummary.closeCount}/${similaritySummary.comparableCount}`);

  if (notRecommended) return { level: "review", reasons };
  if (hardRisk) return { level: "review", reasons };
  if (backupOnly) return { level: "low_confidence", reasons };
  if (!coverageOk || lowDistinguish) return { level: "low_confidence", reasons };
  if (close) return { level: "low_confidence", reasons };
  return { level: "auto", reasons };
}

function hasClearLead(top, second, pairwise) {
  if (!top || !second) return false;
  const scoreGap = (top.avgScore || 0) - (second.avgScore || 0);
  const effectiveWinGap = (top.effectiveWins || 0) - (second.effectiveWins || 0);
  const hardErrorNotWorse =
    (top.criticalErrors || 0) <= (second.criticalErrors || 0)
    && (top.structureErrors || 0) <= (second.structureErrors || 0);
  const errorNotWorse =
    hardErrorNotWorse
    && (top.semanticErrors || 0) <= (second.semanticErrors || 0) + 1
    && (top.asrErrors || 0) <= (second.asrErrors || 0) + 2
    && (top.terminologyErrors || 0) <= (second.terminologyErrors || 0) + 2;
  if (!hardErrorNotWorse) return false;
  if (pairwise.comparablePairs >= 1 && effectiveWinGap >= 1 && scoreGap >= 3) return true;
  if (scoreGap >= 5 && errorNotWorse) return true;
  return false;
}

function compareDisplayRanking(a, b) {
  const roundedGap = Math.round(b.avgScore || 0) - Math.round(a.avgScore || 0);
  if (roundedGap !== 0) return roundedGap;
  return compareAggregateRanking(a, b);
}

function buildPlainConclusionBasis(files, rankings, pairwise, similaritySummary, top, second, decision) {
  const selectedCount = files.length;
  const completedCount = rankings.length ? Math.max(...rankings.map((item) => item.reportsCount || 0), 0) : 0;
  const orderText = buildRankingOrderText(rankings);
  const scoreText = second ? `平均分 ${Math.round(top.avgScore)}:${Math.round(second.avgScore)}` : `平均分 ${Math.round(top.avgScore)}`;
  const errorText = second ? `严重错误 ${top.criticalErrors}:${second.criticalErrors}` : `严重错误 ${top.criticalErrors}`;
  const progressText = `已选 ${selectedCount} 个，完成质检 ${completedCount}/${selectedCount}`;
  const reviewText = decision.reasons.length ? `注意：${decision.reasons[0]}。` : "";
  const closeText = similaritySummary.closeCount ? `${similaritySummary.closeCount}/${similaritySummary.comparableCount} 个样本差距很小。` : "";
  const criticalFilesText = buildCriticalFilesText(files);
  const structureText = buildSelectedStructureSummary(files);
  return `依据：${progressText}；${structureText}；排序 ${orderText}；${scoreText}；${errorText}。${criticalFilesText}${reviewText}${closeText}`;
}

function buildSelectedStructureSummary(files) {
  const total = files.length;
  const checked = files.filter((file) => Object.values(file.polish).some((result) => result?.status === "success" || result?.status === "failed")).length;
  const bad = files.filter((file) => file.structureStatus === "bad").map((file) => `#${file.index}`);
  if (!total) return "润色结构：未选择文件";
  if (!checked) return `润色结构：已选 ${total} 个，尚未润色`;
  if (!bad.length) return `润色结构：已选 ${total} 个均正常`;
  return `润色结构：${bad.length}/${total} 个异常（${bad.slice(0, 8).join("、")}${bad.length > 8 ? " 等" : ""}）`;
}

function buildCriticalFilesText(files) {
  const items = files
    .map((file) => ({ index: file.index, count: fileCriticalErrorCount(file) }))
    .filter((item) => item.count > 0);
  if (!items.length) return "";
  const visible = items.slice(0, 8).map((item) => `#${item.index}(${item.count}个)`).join("、");
  const suffix = items.length > 8 ? ` 等${items.length}个` : "";
  return `有严重错误的文件：${visible}${suffix}。`;
}

function fileCriticalErrorCount(file) {
  return getFileCriticalErrorDetails(file).reduce((sum, item) => sum + item.count, 0);
}

function getFileCriticalErrorDetails(file) {
  return state.templates
    .map((templateId) => {
    const report = file.quality[templateId]?.report;
      return {
        templateId,
        count: report?.error_counts?.critical_errors || 0,
      };
    })
    .filter((item) => item.count > 0);
}

function buildFileCriticalErrorTitle(file) {
  const details = getFileCriticalErrorDetails(file);
  if (!details.length) return "";
  return details.map((item) => `${displayTemplateId(item.templateId)}：${item.count}个`).join("；");
}

function formatSignedNumber(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${formatNumber(number)}` : formatNumber(number);
}

function isLocalMockRuntime() {
  return Boolean(window.subtitlePolishMockRuntime);
}

function hasRealPolishRunner() {
  return typeof getRealPolishRunner() === "function";
}

function hasRealQualityRunner() {
  return typeof getRealQualityRunner() === "function";
}

function getRealPolishRunner() {
  return getRuntimeFunction("polish", "runSubtitlePolish");
}

function getRealQualityRunner() {
  return getRuntimeFunction("qualityCheck", "runSubtitlePolishQualityCheck");
}

function getRuntimeFunction(runtimeKey, globalName) {
  const scopes = [window];
  try {
    if (window.parent && window.parent !== window) scopes.push(window.parent);
  } catch {
    // Cross-origin parent is not readable; ignore it.
  }
  try {
    if (window.opener) scopes.push(window.opener);
  } catch {
    // Cross-origin opener is not readable; ignore it.
  }

  for (const scope of scopes) {
    try {
      const runtimeFn = scope.subtitlePolishRuntime?.[runtimeKey];
      if (typeof runtimeFn === "function") return runtimeFn.bind(scope.subtitlePolishRuntime);
      const globalFn = scope[globalName];
      if (typeof globalFn === "function") return globalFn.bind(scope);
    } catch {
      // Ignore inaccessible scopes.
    }
  }
  return null;
}

function buildRankingOrderText(rankings) {
  const visible = rankings.slice(0, 5);
  const parts = visible.map((item, index) => `${index + 1}.${displayTemplateId(item.templateId)}(${Math.round(item.avgScore)})`);
  const text = parts.reduce((acc, part, index) => {
    if (index === 0) return part;
    const connector = rankingConnector(visible[index - 1], visible[index]);
    return `${acc}${connector}${part}`;
  }, "");
  const suffix = rankings.length > visible.length ? ` 等${rankings.length}个` : "";
  return `${text}${suffix}`;
}

function rankingConnector(a, b) {
  if (Math.round(a?.avgScore || 0) === Math.round(b?.avgScore || 0)) return " = ";
  if (areRankingsEquivalent(a, b)) return " = ";
  if (areRankingsCloseForDisplay(a, b)) return " ≈ ";
  return " > ";
}

function areRankingsEquivalent(a, b) {
  if (!a || !b) return false;
  const sameWins = Math.abs((a.effectiveWins || 0) - (b.effectiveWins || 0)) < 0.001;
  const sameHighWins = (a.highWins || 0) === (b.highWins || 0);
  const sameCritical = a.criticalErrors === b.criticalErrors;
  const sameStructure = a.structureErrors === b.structureErrors;
  const sameSemantic = a.semanticErrors === b.semanticErrors;
  const sameAsr = a.asrErrors === b.asrErrors;
  const sameTerm = a.terminologyErrors === b.terminologyErrors;
  const scoreClose = Math.abs(a.avgScore - b.avgScore) < 0.5;
  return sameWins && sameHighWins && sameCritical && sameStructure && sameSemantic && sameAsr && sameTerm && scoreClose;
}

function areRankingsCloseForDisplay(a, b) {
  if (!a || !b) return false;
  const noEffectiveLead = Math.abs((a.effectiveWins || 0) - (b.effectiveWins || 0)) < 1;
  const noHighWinLead = (a.highWins || 0) === (b.highWins || 0);
  const hardErrorsSame = a.criticalErrors === b.criticalErrors && a.structureErrors === b.structureErrors;
  const scoreClose = Math.abs(a.avgScore - b.avgScore) <= 5;
  const minorErrorGap =
    Math.abs((a.semanticErrors || 0) - (b.semanticErrors || 0)) <= 1
    && Math.abs((a.asrErrors || 0) - (b.asrErrors || 0)) <= 2
    && Math.abs((a.terminologyErrors || 0) - (b.terminologyErrors || 0)) <= 2;
  return noEffectiveLead && noHighWinLead && hardErrorsSame && scoreClose && minorErrorGap;
}


function displayTemplateId(templateId) {
  const value = String(templateId || "未填写");
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}

function buildPairwiseEvaluations(files) {
  const summary = {
    comparableFiles: 0,
    comparablePairs: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    tieCount: 0,
    byTemplate: new Map(),
    evaluations: [],
  };

  files.forEach((file) => {
    const entries = state.templates
      .map((templateId) => ({
        templateId,
        polish: file.polish[templateId],
        quality: file.quality[templateId],
      }))
      .filter((entry) => entry.polish?.status === "success" && Array.isArray(entry.polish.output) && entry.quality?.status === "success" && entry.quality.report);

    if (entries.length < 2) return;
    summary.comparableFiles += 1;

    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const evaluation = compareFilePair(file, entries[i], entries[j]);
        summary.evaluations.push(evaluation);
        summary.comparablePairs += 1;
        summary[`${evaluation.discriminativePower}Count`] += 1;
        if (evaluation.winner === "tie") summary.tieCount += 1;
        applyPairwiseEvaluation(summary.byTemplate, evaluation);
      }
    }
  });

  return summary;
}

function compareFilePair(file, left, right) {
  const leftReport = left.quality.report;
  const rightReport = right.quality.report;
  const similarity = compareSubtitleOutputs(left.polish.output, right.polish.output);
  const leftErrors = weightedErrorCount(leftReport);
  const rightErrors = weightedErrorCount(rightReport);
  const hasScores = Number.isFinite(leftReport.total_score) && Number.isFinite(rightReport.total_score);
  const scoreGap = hasScores ? leftReport.total_score - rightReport.total_score : 0;
  const errorGap = leftErrors - rightErrors;
  const hardWinner = pickHardCheckWinner(left, right);
  let winner = hardWinner;
  let reason = "严重错误、结构硬错误和整体质检分接近。";

  if (!winner && (similarity.isExact || similarity.score >= 0.97)) {
    winner = "tie";
    reason = "两个模型在该小文件的整份润色输出完全一致或高度接近。";
  } else if (!winner && hasScores && Math.abs(scoreGap) >= 3) {
    winner = scoreGap > 0 ? left.templateId : right.templateId;
    reason = "同一小文件内质检总分存在可见差距。";
  } else if (!winner && Math.abs(errorGap) >= 2) {
    winner = errorGap < 0 ? left.templateId : right.templateId;
    reason = "同一小文件内错误数量和错误等级存在差距。";
  } else if (!winner) {
    winner = "tie";
  }

  const discriminativePower = getDiscriminativePower({
    similarity,
    winner,
    scoreGap: Math.abs(scoreGap),
    errorGap: Math.abs(errorGap),
    leftReport,
    rightReport,
  });

  return {
    fileIndex: file.index,
    leftTemplateId: left.templateId,
    rightTemplateId: right.templateId,
    winner,
    discriminativePower,
    weight: discriminativePower === "high" ? 1 : discriminativePower === "medium" ? 0.5 : 0,
    similarityScore: similarity.score,
    reason,
  };
}

function pickHardCheckWinner(left, right) {
  const leftCounts = left.quality.report.error_counts || {};
  const rightCounts = right.quality.report.error_counts || {};
  const checks = [
    ["critical_errors", 1],
    ["structure_errors", 1],
  ];
  for (const [key, minGap] of checks) {
    const gap = (leftCounts[key] || 0) - (rightCounts[key] || 0);
    if (Math.abs(gap) >= minGap) return gap < 0 ? left.templateId : right.templateId;
  }
  return "";
}

function getDiscriminativePower({ similarity, winner, scoreGap, errorGap, leftReport, rightReport }) {
  if (winner === "tie" || similarity.isExact || similarity.score >= 0.97) return "low";
  const hasHardGap = Math.abs((leftReport.error_counts?.critical_errors || 0) - (rightReport.error_counts?.critical_errors || 0)) >= 1
    || Math.abs((leftReport.error_counts?.structure_errors || 0) - (rightReport.error_counts?.structure_errors || 0)) >= 1;
  if (hasHardGap || scoreGap >= 6 || errorGap >= 4 || similarity.score < 0.9) return "high";
  if (scoreGap >= 3 || errorGap >= 2 || similarity.score < 0.97) return "medium";
  return "low";
}

function weightedErrorCount(report) {
  const counts = report.error_counts || {};
  return (
    (counts.critical_errors || 0) * 8
    + (counts.structure_errors || 0) * 5
    + (counts.semantic_errors || 0) * 3
    + (counts.asr_errors || 0) * 2
    + (counts.terminology_errors || 0) * 2
    + (counts.over_polishing_errors || 0)
    + (counts.translation_errors || 0)
  );
}

function applyPairwiseEvaluation(map, evaluation) {
  [evaluation.leftTemplateId, evaluation.rightTemplateId].forEach((templateId) => {
    if (!map.has(templateId)) {
      map.set(templateId, {
        effectiveWins: 0,
        pairwiseWins: 0,
        pairwiseLosses: 0,
        pairwiseTies: 0,
        highWins: 0,
        mediumWins: 0,
        lowComparisons: 0,
      });
    }
  });

  const left = map.get(evaluation.leftTemplateId);
  const right = map.get(evaluation.rightTemplateId);
  if (evaluation.discriminativePower === "low") {
    left.lowComparisons += 1;
    right.lowComparisons += 1;
  }
  if (evaluation.winner === "tie") {
    left.pairwiseTies += 1;
    right.pairwiseTies += 1;
    return;
  }

  const winner = map.get(evaluation.winner);
  const loser = evaluation.winner === evaluation.leftTemplateId ? right : left;
  winner.pairwiseWins += 1;
  winner.effectiveWins += evaluation.weight;
  if (evaluation.discriminativePower === "high") winner.highWins += 1;
  if (evaluation.discriminativePower === "medium") winner.mediumWins += 1;
  loser.pairwiseLosses += 1;
}

function applyPairwiseStatsToRankings(rankings, pairwise) {
  rankings.forEach((item) => {
    const stats = pairwise.byTemplate.get(item.templateId) || {};
    item.effectiveWins = stats.effectiveWins || 0;
    item.pairwiseWins = stats.pairwiseWins || 0;
    item.pairwiseLosses = stats.pairwiseLosses || 0;
    item.pairwiseTies = stats.pairwiseTies || 0;
    item.highWins = stats.highWins || 0;
    item.mediumWins = stats.mediumWins || 0;
    item.lowComparisons = stats.lowComparisons || 0;
  });
}

function compareAggregateRanking(a, b) {
  return (
    (b.effectiveWins || 0) - (a.effectiveWins || 0)
    || (b.highWins || 0) - (a.highWins || 0)
    || compareRanking(a, b)
  );
}

function analyzeSelectedPolishSimilarity(files) {
  return files.reduce(
    (acc, file) => {
      const result = analyzeFilePolishSimilarity(file);
      if (!result.isComparable) return acc;
      acc.comparableCount += 1;
      if (result.isExact) acc.exactCount += 1;
      if (result.isClose) acc.closeCount += 1;
      return acc;
    },
    { comparableCount: 0, closeCount: 0, exactCount: 0 },
  );
}

function analyzeFilePolishSimilarity(file) {
  const entries = state.templates
    .map((templateId) => ({ templateId, result: file.polish[templateId] }))
    .filter((entry) => entry.result?.status === "success" && Array.isArray(entry.result.output));
  if (entries.length < 2) {
    return { isComparable: false, isClose: false, isExact: false, message: "" };
  }

  let maxSimilarity = 0;
  let hasExact = false;
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const similarity = compareSubtitleOutputs(entries[i].result.output, entries[j].result.output);
      maxSimilarity = Math.max(maxSimilarity, similarity.score);
      if (similarity.isExact) hasExact = true;
    }
  }
  const isClose = hasExact || maxSimilarity >= 0.95;
  return {
    isComparable: true,
    isClose,
    isExact: hasExact,
    score: maxSimilarity,
    message: hasExact
      ? "差距小样本：多个模型输出一致，已计入统计，但不拉开模型差距。"
      : "差距小样本：多个模型输出接近，已计入统计，但不作为强推荐依据。",
  };
}

function compareSubtitleOutputs(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return { score: 0, isExact: false };
  }
  const leftNormalized = left.map(normalizeSubtitleRowForCompare);
  const rightNormalized = right.map(normalizeSubtitleRowForCompare);
  const isExact = leftNormalized.every((row, index) => row === rightNormalized[index]);
  if (isExact) return { score: 1, isExact: true };

  const sameRows = leftNormalized.reduce((count, row, index) => count + (row === rightNormalized[index] ? 1 : 0), 0);
  const rowScore = sameRows / Math.max(1, leftNormalized.length);
  const textScore = wholeTextSimilarity(leftNormalized.join("\n"), rightNormalized.join("\n"));
  return { score: Math.max(rowScore, textScore), isExact: false };
}

function analyzePolishEffectiveness(original, polished) {
  const totalRows = Array.isArray(original) ? original.length : 0;
  if (!Array.isArray(original) || !Array.isArray(polished)) {
    return { totalRows, changedRows: 0, changeRatio: 0, asrCandidatesTotal: 0, asrCandidatesFixed: 0 };
  }
  const len = Math.min(original.length, polished.length);
  let changedRows = 0;
  for (let index = 0; index < len; index += 1) {
    if (normalizeTextForEffect(original[index]?.t) !== normalizeTextForEffect(polished[index]?.t)) {
      changedRows += 1;
    }
  }

  const candidates = buildAsrVerificationContext(original).verifiable_asr_candidates || [];
  const asrCandidatesFixed = candidates.reduce((count, candidate) => {
    const outputRow = polished[candidate.row - 1];
    const text = String(outputRow?.t || "");
    return count + (isCandidateFixed(text, candidate) ? 1 : 0);
  }, 0);

  return {
    totalRows,
    changedRows,
    changeRatio: totalRows ? changedRows / totalRows : 0,
    asrCandidatesTotal: candidates.length,
    asrCandidatesFixed,
  };
}

function normalizeTextForEffect(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isCandidateFixed(text, candidate) {
  const rawText = String(text || "");
  const rawSuggested = String(candidate.suggested || "");
  const rawObserved = String(candidate.observed || "");
  if (rawSuggested && rawText.includes(rawSuggested) && (!rawObserved || !rawText.includes(rawObserved))) {
    return true;
  }
  const normalizedText = normalizeComparableLoose(text);
  const suggested = normalizeComparableLoose(candidate.suggested);
  const observed = normalizeComparableLoose(candidate.observed);
  if (suggested === observed) return false;
  return suggested && normalizedText.includes(suggested) && (!observed || !normalizedText.includes(observed));
}

function normalizeComparableLoose(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z\u4e00-\u9fa5]+/gi, "");
}

function wholeTextSimilarity(leftText, rightText) {
  if (!leftText && !rightText) return 1;
  if (!leftText || !rightText) return 0;
  const leftTokens = new Set(splitComparableText(leftText));
  const rightTokens = new Set(splitComparableText(rightText));
  if (!leftTokens.size && !rightTokens.size) return 1;
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / Math.max(1, union);
}

function splitComparableText(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z\u4e00-\u9fa5]+/gi, "");
  const chunks = normalized.match(/[a-z0-9]+|[\u4e00-\u9fa5]/g);
  return chunks || [];
}

function normalizeSubtitleRowForCompare(row) {
  return `${row?.s ?? ""}:${String(row?.t ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z\u4e00-\u9fa5]+/gi, "")}`;
}

function resultCard(title, status, subtitle, retryHandler, forceDisabled = false, actionTitle = "", taskId = "") {
  const card = document.createElement("article");
  card.className = "result-card";
  const head = document.createElement("div");
  head.className = "card-head";
  const titleBox = document.createElement("div");
  titleBox.className = "card-title";
  titleBox.innerHTML = `${escapeHtml(title)}<small>${escapeHtml(subtitle)}</small><small class="task-id">taskid：${escapeHtml(taskId || "--")}</small>`;
  const retry = document.createElement("button");
  retry.className = "small-btn";
  retry.textContent = status === "success" ? "重试" : "执行";
  retry.disabled = status === "running" || forceDisabled;
  retry.title = actionTitle;
  retry.addEventListener("click", retryHandler);
  head.append(titleBox, retry);
  const body = document.createElement("div");
  body.className = "card-body";
  card.append(head, body);
  return card;
}

function emptySmall(text) {
  const el = document.createElement("div");
  el.className = "muted";
  el.textContent = text;
  return el;
}

function statusTag(text, className) {
  const el = document.createElement("span");
  el.className = `tag ${className || ""}`.trim();
  el.textContent = text;
  return el;
}

function codeBlock(value) {
  const pre = document.createElement("pre");
  pre.className = "result-code";
  pre.textContent = typeof value === "string" ? value : pretty(value);
  return pre;
}

function metricRow(subscores) {
  const names = [
    ["structure", "结构"],
    ["semantic_fidelity", "语义"],
    ["asr_correction", "ASR"],
    ["terminology", "术语"],
    ["polish_and_translation_readiness", "友好度"],
  ];
  const row = document.createElement("div");
  row.className = "metric-row";
  names.forEach(([key, label]) => {
    const item = document.createElement("div");
    item.className = "metric";
    item.innerHTML = `<strong>${formatMetricValue(subscores[key])}</strong><span>${label}</span>`;
    row.appendChild(item);
  });
  return row;
}

function formatMetricValue(value) {
  return Number.isFinite(value) ? String(value) : "--";
}

function issueList(items) {
  const ul = document.createElement("ul");
  ul.className = "issue-list";
  (items && items.length ? items : ["暂无明显问题"]).slice(0, 2).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = simplifyIssueText(text);
    ul.appendChild(li);
  });
  return ul;
}

function criticalIssuePanel(report) {
  const count = report?.error_counts?.critical_errors || 0;
  if (!count) return document.createDocumentFragment();

  const panel = document.createElement("div");
  panel.className = "critical-issue-panel";
  const title = document.createElement("div");
  title.className = "critical-issue-title";
  title.textContent = `严重错误定位：质检返回 ${count} 个`;
  panel.append(title);

  const items = extractCriticalIssueItems(report);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "critical-issue-empty";
    empty.textContent = "质检结果只返回了严重错误数量，没有返回具体字幕行；请展开下方 JSON 查找 critical_errors/representative_issues，或重试质检。";
    panel.append(empty);
    return panel;
  }

  const list = document.createElement("ol");
  list.className = "critical-issue-list";
  items.slice(0, Math.max(count, 3)).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = formatCriticalIssueItem(item);
    list.append(li);
  });
  panel.append(list);
  return panel;
}

function extractCriticalIssueItems(report) {
  const raw = report?.raw_result && typeof report.raw_result === "object" ? report.raw_result : {};
  return collectIssueObjects(raw).filter((issue) => {
    const text = issueSearchText(issue);
    return [
      "critical",
      "severe",
      "fatal",
      "blocker",
      "high_risk",
      "严重",
      "重大",
      "不可用",
      "关键事实完全错误",
    ].some((keyword) => text.includes(String(keyword).toLowerCase()));
  });
}

function formatCriticalIssueItem(item) {
  if (typeof item === "string") return simplifyIssueText(item);
  if (!item || typeof item !== "object") return String(item || "");
  const index = item.index ?? item.line ?? item.line_no ?? item.lineNo ?? item.subtitle_index ?? item.s;
  const original = item.original ?? item.source ?? item.before ?? item.raw ?? "";
  const polished = item.polished ?? item.output ?? item.after ?? item.target ?? "";
  const issue = issueText(item);
  const parts = [];
  if (index != null && index !== "") parts.push(`位置 ${index}`);
  if (original) parts.push(`原文：${String(original)}`);
  if (polished) parts.push(`润色：${String(polished)}`);
  if (issue) parts.push(`问题：${simplifyIssueText(issue)}`);
  return parts.length ? parts.join("；") : JSON.stringify(item);
}

function simplifyIssueText(text) {
  const value = String(text || "").trim();
  const replacements = [
    ["英文源字幕结构稳定，建议重点复核大小写、标点和专有名词一致性。", "英文字幕：重点复核大小写、标点和专有名词。"],
    ["结构稳定但改动较克制，适合作为低风险备选；ASR 纠错覆盖率需要重点复核。", "改动较克制：重点复核 ASR 纠错覆盖。"],
    ["ASR 纠错覆盖较好，结构保持稳定，适合优先复核专有名词。", "ASR 纠错较好：优先复核专有名词。"],
    ["结构稳定，ASR 纠错、术语统一和润色自然度较均衡。", "结构稳定，ASR、术语和润色较均衡。"],
    ["结构稳定，润色自然，适合作为后续翻译源文本。", "结构稳定，润色自然。"],
  ];
  const match = replacements.find(([source]) => source === value);
  return match ? match[1] : value;
}

function polishStatusText(status) {
  return {
    idle: "未润色",
    running: "润色中",
    success: "润色成功",
    failed: "润色失败",
    blocked: "不可润色",
  }[status] || "未润色";
}

function checkStatusText(status) {
  return {
    idle: "未质检",
    running: "质检中",
    success: "质检完成",
    failed: "质检失败",
  }[status] || "未质检";
}

function structureStatusText(status) {
  return {
    unchecked: "结构未检查",
    ok: "润色结构正常",
    bad: "润色结构异常",
  }[status] || "结构未检查";
}

function statusClass(status) {
  if (status === "success") return "success";
  if (status === "failed" || status === "blocked") return "error";
  if (status === "running") return "warn";
  return "";
}

function structureClass(status) {
  if (status === "ok") return "success";
  if (status === "bad") return "error";
  return "";
}

function decisionText(decision) {
  const normalized = normalizeProductionDecision(decision);
  return {
    recommended: "建议使用",
    backup: "可作为备选",
    needs_review: "确认后使用",
    not_recommended: "暂不建议使用",
  }[normalized] || "未知";
}

function decisionClass(decision) {
  const normalized = normalizeProductionDecision(decision);
  if (normalized === "recommended") return "success";
  if (normalized === "backup" || normalized === "needs_review") return "warn";
  return "error";
}

function normalizeProductionDecision(decision) {
  const value = String(decision || "").trim().toLowerCase();
  if (["recommended", "recommend", "pass", "approved", "推荐", "可推荐"].includes(value)) return "recommended";
  if (["backup", "alternative", "acceptable", "备选", "候选"].includes(value)) return "backup";
  if (["needs_review", "need_review", "review", "manual_review", "requires_review", "需复核", "需要复核", "人工复核"].includes(value)) return "needs_review";
  if (["not_recommended", "not recommend", "reject", "failed", "fail", "不推荐", "不可推荐"].includes(value)) return "not_recommended";
  return value || "unknown";
}

function canCheck(file) {
  return Object.values(file.polish).some((result) => result.status === "success" && result.structureOk);
}

function renameTemplate(index, nextId) {
  if (nextId && state.templates.some((id, currentIndex) => id === nextId && currentIndex !== index)) {
    showToast("字幕润色模板 ID 不能重复。");
    renderTemplates();
    return;
  }

  const oldId = state.templates[index];
  state.templates[index] = nextId;
  state.files.forEach((file) => {
    delete file.polish[oldId];
    delete file.polish[nextId];
    delete file.quality[oldId];
    delete file.quality[nextId];
  });
  refreshAggregateFileStatuses();
  showToast("模板 ID 已变更，请重新润色和质检。");
  render();
}

function removeTemplate(index) {
  if (state.templates.length <= 1) return;
  const removed = state.templates.splice(index, 1)[0];
  state.files.forEach((file) => {
    delete file.polish[removed];
    delete file.quality[removed];
  });
  refreshAggregateFileStatuses();
  render();
}

function addTemplate() {
  state.templates.push("");
  render();
}

async function runPolishForFiles(files) {
  if (!files.length) {
    showToast("请先选择可润色的小文件。");
    return;
  }
  const templateIds = state.templates.filter((templateId) => String(templateId || "").trim());
  if (!templateIds.length) {
    showToast("请先填写真实字幕润色模板 ID。");
    return;
  }
  if (state.polishBatchRunning) return;
  state.polishBatchRunning = true;
  const jobs = [];
  files.forEach((file) => {
    templateIds.forEach((templateId) => {
      if (!file || file.parseError) return;
      file.polishStatus = "running";
      file.structureStatus = "unchecked";
      file.polish[templateId] = { status: "running" };
      delete file.quality[templateId];
      jobs.push(() => runSingleTemplatePolish(file, templateId, false, false));
    });
  });
  render();
  showToast(`已开始创建 ${jobs.length} 个润色任务，并发 ${Math.min(maxConcurrentTasks, jobs.length)} 个。`);
  try {
    await runConcurrentJobs(jobs, maxConcurrentTasks);
  } finally {
    state.polishBatchRunning = false;
    render();
  }
}

async function runSingleTemplatePolish(file, templateId, shouldRender = true, markRunning = true) {
  if (!file || file.parseError) return;
  if (markRunning) {
    file.polishStatus = "running";
    file.structureStatus = "unchecked";
    file.polish[templateId] = { status: "running" };
    delete file.quality[templateId];
  }
  if (shouldRender) render();

  try {
    const polishResult = await runPolishTemplate(file.subtitles, templateId, file, (taskId) => {
      file.polish[templateId] = { ...(file.polish[templateId] || {}), status: "running", taskId };
      if (shouldRender) render();
    });
    const output = polishResult.output;
    const structure = inspectStructure(file.subtitles, output);
    file.polish[templateId] = {
      status: structure.ok ? "success" : "failed",
      output,
      taskId: polishResult.taskId,
      taskIds: polishResult.taskIds || [],
      autoRetried: Boolean(polishResult.autoRetried),
      structureOk: structure.ok,
      error: structure.ok ? "" : structure.errors.join("；"),
    };
  } catch (error) {
    const previous = file.polish[templateId] || {};
    file.polish[templateId] = {
      status: "failed",
      error: error.message || "润色失败",
      taskId: previous.taskId || "",
      taskIds: previous.taskIds || [],
    };
  }
  refreshFileStatus(file);
  if (shouldRender) render();
}

async function runCheckForFiles(files) {
  const runnable = files.filter(canCheck);
  if (!runnable.length) {
    showToast("请先完成润色，且润色结构正常后再质检。");
    return;
  }
  if (!String(state.judgeTemplate || "").trim()) {
    showToast("请先填写真实质检分析模板 ID。");
    return;
  }
  if (state.checkBatchRunning) return;
  state.checkBatchRunning = true;
  const jobs = [];
  runnable.forEach((file) => {
    state.templates.forEach((templateId) => {
      if (file.polish[templateId]?.status === "success" && file.polish[templateId]?.structureOk) {
        file.checkStatus = "running";
        file.quality[templateId] = { status: "running" };
        jobs.push(() => runSingleTemplateCheck(file, templateId, false, false));
      }
    });
  });
  render();
  showToast(`已开始创建 ${jobs.length} 个质检任务，并发 ${Math.min(maxConcurrentTasks, jobs.length)} 个。`);
  try {
    await runConcurrentJobs(jobs, maxConcurrentTasks);
  } finally {
    state.checkBatchRunning = false;
    render();
  }
}

async function runSingleTemplateCheck(file, templateId, shouldRender = true, markRunning = true) {
  const polished = file.polish[templateId];
  if (!polished || polished.status !== "success" || !polished.structureOk) {
    showToast("当前模板未完成结构正常的润色，不能质检。");
    return;
  }
  if (markRunning) {
    file.checkStatus = "running";
    file.quality[templateId] = { status: "running" };
  }
  if (shouldRender) render();

  try {
    const qualityResult = await runQualityCheck(file.subtitles, polished.output, templateId, state.judgeTemplate, file, (taskId) => {
      file.quality[templateId] = { ...(file.quality[templateId] || {}), status: "running", taskId };
      if (shouldRender) render();
    });
    if (!Number.isFinite(qualityResult.report?.total_score)) {
      file.quality[templateId] = {
        status: "failed",
        error: "质检任务未返回可解析分值，请重试或检查质检模板输出字段。",
        taskId: qualityResult.taskId,
        report: qualityResult.report,
      };
      refreshFileStatus(file);
      if (shouldRender) render();
      return;
    }
    file.quality[templateId] = {
      status: "success",
      report: qualityResult.report,
      taskId: qualityResult.taskId,
      autoRetried: Boolean(qualityResult.autoRetried),
    };
  } catch (error) {
    const previous = file.quality[templateId] || {};
    file.quality[templateId] = { status: "failed", error: error.message || "质检失败", taskId: previous.taskId || "" };
  }
  refreshFileStatus(file);
  if (shouldRender) render();
}

async function runConcurrentJobs(jobs, limit) {
  const queue = jobs.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      await job();
      render();
    }
  });
  await Promise.all(workers);
}

async function runPolishTemplate(subtitles, templateId, file, onTaskCreated) {
  if (!templateId) {
    throw new Error("请先填写真实字幕润色模板 ID。");
  }
  const asrContext = buildAsrVerificationContext(subtitles);
  const chunks = splitSubtitleChunks(subtitles, polishChunkSize);
  const output = [];
  const taskIds = [];
  let autoRetried = false;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const chunkInfo = {
      chunkIndex: chunkIndex + 1,
      chunkCount: chunks.length,
      startRow: chunk.start + 1,
      endRow: chunk.end,
      fullLength: subtitles.length,
    };
    const chunkResult = await runPolishChunkWithAutoRetry(templateId, file, chunk.rows, asrContext, chunkInfo, taskIds, onTaskCreated);
    addUniqueTaskId(taskIds, chunkResult.taskId);
    autoRetried = autoRetried || Boolean(chunkResult.autoRetried);
    if (typeof onTaskCreated === "function") onTaskCreated(formatTaskIds(taskIds));

    const structure = inspectStructure(chunk.rows, chunkResult.output);
    if (!structure.ok) {
      throw new Error(`第 ${chunkIndex + 1}/${chunks.length} 段润色结构异常：${structure.errors.join("；")}`);
    }
    output.push(...chunkResult.output);
  }

  return { output, taskId: formatTaskIds(taskIds), taskIds, autoRetried };
}

async function runPolishChunkWithAutoRetry(templateId, file, subtitles, asrContext, chunkInfo, taskIds, onTaskCreated) {
  let lastError = null;
  let lastResponse = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryContext = attempt === 1
      ? null
      : {
          reason: lastError?.message || "上次输出不是合法字幕 JSON 数组。",
          previousOutputPreview: previewResponseForError(lastResponse),
        };
    const payload = {
      template_id: templateId,
      prompt: buildPolishPrompt(subtitles, asrContext, chunkInfo, retryContext),
      subtitles,
      subtitle_len: subtitles.length,
      file_index: file.index,
      chunk_index: chunkInfo.chunkIndex,
      chunk_count: chunkInfo.chunkCount,
      retry_attempt: attempt - 1,
    };
    recordRuntimePayload("polish", payload);
    try {
      const response = await callRealModelRuntime("polish", payload, (taskId) => {
        addUniqueTaskId(taskIds, taskId);
        if (typeof onTaskCreated === "function") onTaskCreated(formatTaskIds(taskIds));
      });
      lastResponse = response;
      const result = normalizePolishResponse(response);
      const structure = inspectStructure(subtitles, result.output);
      if (!structure.ok) {
        throw new Error(`润色结构异常：${structure.errors.join("；")}`);
      }
      result.autoRetried = attempt > 1;
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`第 ${chunkInfo.chunkIndex}/${chunkInfo.chunkCount} 段润色失败，已自动重试 1 次：${lastError?.message || "未知错误"}`);
}

async function runQualityCheck(original, polished, templateId, judgeTemplateId, file, onTaskCreated) {
  if (!judgeTemplateId) {
    throw new Error("请先填写真实质检分析模板 ID。");
  }
  const asrContext = buildAsrVerificationContext(original);
  let lastError = null;
  let lastResponse = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryContext = attempt === 1
      ? null
      : {
          reason: lastError?.message || "上次质检未返回可解析分值。",
          previousOutputPreview: previewResponseForError(lastResponse),
        };
    const payload = {
      template_id: judgeTemplateId,
      polish_template_id: templateId,
      prompt: buildQualityPrompt(original, polished, asrContext, retryContext),
      translated_content: polished,
      original_subtitles: original,
      polished_subtitles: polished,
      subtitle_len: original.length,
      file_index: file.index,
      retry_attempt: attempt - 1,
    };
    recordRuntimePayload("quality", payload);
    try {
      const response = await callRealModelRuntime("quality", payload, onTaskCreated);
      lastResponse = response;
      const result = normalizeQualityResponse(response, templateId, judgeTemplateId);
      applyHardStructureCheckToQualityReport(result.report, original, polished);
      if (!Number.isFinite(result.report?.total_score)) {
        throw new Error("质检任务未返回可解析分值。");
      }
      result.autoRetried = attempt > 1;
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`质检失败，已自动重试 1 次：${lastError?.message || "未知错误"}`);
}

function applyHardStructureCheckToQualityReport(report, original, polished) {
  if (!report || typeof report !== "object") return;
  const structure = inspectStructure(original, polished);
  report.error_counts ||= {};
  report.error_counts.structure_errors = structure.ok ? 0 : structure.errors.length || 1;
  report.structure_check_source = "frontend_hard_check";
  report.structure_check_message = structure.ok ? "润色结构正常" : structure.errors.join("；");
}

async function callRealModelRuntime(type, payload, onTaskCreated) {
  const runner = type === "polish" ? getRealPolishRunner() : getRealQualityRunner();
  if (typeof runner === "function") {
    const response = await runner(payload);
    const taskId = extractTaskId(response);
    if (taskId && typeof onTaskCreated === "function") onTaskCreated(taskId);
    return response;
  }

  const endpoint = getConfiguredBackendEndpoint(type);
  if (endpoint) {
    return postJson(endpoint, payload);
  }

  return requestLlmTaskByTemplateId(type, payload, onTaskCreated);
}

async function requestLlmTaskByTemplateId(type, payload, onTaskCreated) {
  const reqUrl = `https://${fixedTechEndpoint.replace(/\/+$/, "")}/tasks/llm/chats`;
  const templateVariables = {
    PROMPT: payload.prompt,
    prompt: payload.prompt,
    INPUT: payload.prompt,
    input: payload.prompt,
    CONTENT: payload.prompt,
    content: payload.prompt,
    USER_CONTENT: payload.prompt,
    user_content: payload.prompt,
    SUBTITLES_JSON: JSON.stringify(payload.subtitles || payload.polished_subtitles || payload.translated_content || []),
    subtitles_json: JSON.stringify(payload.subtitles || payload.polished_subtitles || payload.translated_content || []),
    SUBTITLE_LEN: payload.subtitle_len || "",
    subtitle_len: payload.subtitle_len || "",
    FILE_INDEX: payload.file_index || "",
    file_index: payload.file_index || "",
  };
  if (type === "quality") {
    templateVariables.POLISH_TEMPLATE_ID = payload.polish_template_id || "";
    templateVariables.polish_template_id = payload.polish_template_id || "";
    templateVariables.ORIGINAL_SUBTITLES_JSON = JSON.stringify(payload.original_subtitles || []);
    templateVariables.original_subtitles_json = JSON.stringify(payload.original_subtitles || []);
    templateVariables.POLISHED_SUBTITLES_JSON = JSON.stringify(payload.polished_subtitles || payload.translated_content || []);
    templateVariables.polished_subtitles_json = JSON.stringify(payload.polished_subtitles || payload.translated_content || []);
  }

  const createBody = {
    response_type: 0,
    template_id: payload.template_id,
    template_variables: JSON.stringify(templateVariables),
    po: "reccloud",
  };

  const createResp = await fetch(reqUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": fixedXApiKey,
    },
    body: JSON.stringify(createBody),
  });
  if (!createResp.ok) {
    throw new Error(`创建${type === "polish" ? "润色" : "质检"}任务失败：HTTP ${createResp.status}`);
  }

  const createJson = await createResp.json();
  const taskId = extractTaskId(createJson);
  if (!taskId) throw new Error("创建任务失败：响应中缺少 task_id");
  if (typeof onTaskCreated === "function") onTaskCreated(taskId);

  const queryResponse = await pollLlmTask(reqUrl, taskId);
  const data = queryResponse?.data || queryResponse;
  const text = cleanMarkdownCodeBlock(data?.text || "");
  if (!text) throw new Error("任务已完成但未返回 text");

  return {
    task_id: taskId,
    data: {
      ...(data || {}),
      text,
    },
    query_response: queryResponse,
  };
}

async function pollLlmTask(reqUrl, taskId) {
  const maxAttempts = 300;
  const intervalMs = 2000;
  const maxRetries = 3;
  const retryDelayMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(intervalMs);
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        const response = await fetch(`${reqUrl}/${taskId}`, {
          method: "GET",
          headers: { "x-api-key": fixedXApiKey },
        });
        if (!response.ok && response.status >= 500 && response.status < 600 && retryCount < maxRetries) {
          retryCount += 1;
          await sleep(retryDelayMs);
          continue;
        }
        if (!response.ok) {
          throw new Error(`查询任务失败：HTTP ${response.status}${retryCount ? `（已重试 ${retryCount} 次）` : ""}`);
        }

        const json = await response.json();
        const data = json?.data || json;
        const state = data?.state ?? data?.data?.state;
        if (state === 1) return json;
        if (typeof state === "number" && state < 0) {
          throw new Error("任务执行失败（state < 0）");
        }
        break;
      } catch (error) {
        if (retryCount < maxRetries && String(error?.message || "").includes("fetch")) {
          retryCount += 1;
          await sleep(retryDelayMs);
          continue;
        }
        throw error;
      }
    }
  }

  throw new Error("查询超时：超过最大轮询次数");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanMarkdownCodeBlock(text) {
  if (typeof text !== "string") return text;
  return text
    .trim()
    .replace(/^```(?:json|JSON)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const text = await response.text();
  const body = text ? parseMaybeJson(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error || body?.msg || text || `HTTP ${response.status}`;
    throw new Error(`后台真实接口调用失败：${message}`);
  }
  return body;
}

function getConfiguredBackendEndpoint(type) {
  const explicitKey = type === "polish" ? "subtitlePolishPolishEndpoint" : "subtitlePolishQualityEndpoint";
  const explicitEndpoint = readRuntimeSetting(explicitKey);
  if (explicitEndpoint) return explicitEndpoint;

  const base = readRuntimeSetting("subtitlePolishApiBase") || (location.protocol.startsWith("http") ? location.origin : "");
  if (!base) return "";

  const pathKey = type === "polish" ? "subtitlePolishPolishPath" : "subtitlePolishQualityPath";
  const defaultPath = type === "polish" ? "/api/subtitle/polish" : "/api/subtitle/polish/quality-check";
  return new URL(readRuntimeSetting(pathKey) || defaultPath, base.endsWith("/") ? base : `${base}/`).toString();
}

function readRuntimeSetting(key) {
  try {
    const value = window[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // Ignore inaccessible runtime settings.
  }
  try {
    const queryValue = new URLSearchParams(location.search).get(key);
    if (queryValue && queryValue.trim()) return queryValue.trim();
  } catch {
    // Ignore malformed query strings.
  }
  try {
    const storageValue = localStorage.getItem(key);
    if (storageValue && storageValue.trim()) return storageValue.trim();
  } catch {
    // Ignore unavailable localStorage.
  }
  return "";
}

function buildPolishPrompt(subtitles, asrContext, chunkInfo = null, retryContext = null) {
  const chunkLines = chunkInfo
    ? [
        "【当前分段信息】",
        `当前只处理第 ${chunkInfo.chunkIndex}/${chunkInfo.chunkCount} 段，原小文件总行数 ${chunkInfo.fullLength}，本段对应原小文件第 ${chunkInfo.startRow}-${chunkInfo.endRow} 行。`,
        "输出只需要返回当前分段的 JSON 数组，不要返回其他分段。",
        "",
      ]
    : [];
  const retryLines = retryContext
    ? [
        "【自动重试纠偏】",
        "上一次输出无效，原因如下：",
        retryContext.reason || "未返回合法字幕 JSON 数组。",
        "上一次输出预览：",
        retryContext.previousOutputPreview || "",
        "本次必须只输出最终完整字幕 JSON 数组，不得输出纠错说明、候选修正列表、原因分析、对照表或任何解释文字。",
        "",
      ]
    : [];
  return [
    "你是字幕润色模型。请先阅读【可验证 ASR/hotwords 参考】，再开始润色。",
    "",
    ...chunkLines,
    ...retryLines,
    "【输出硬性格式，必须严格遵守】",
    `1. 输入数组长度是 ${subtitles.length}，输出数组长度必须也是 ${subtitles.length}。`,
    "2. 输出必须只是一整个 JSON 数组，必须以 [ 开头，以 ] 结尾。",
    "3. 数组每一项只能包含两个字段：s 和 t；不得新增、删除、重命名字段。",
    "4. 第 i 项必须对应输入第 i 项；必须原样保留 s 字段，不得修改 s 的值。",
    "5. 只允许修改 t 字段；不得合并、拆分、删除、跳过、重排字幕。",
    "6. 禁止输出解释、注释、markdown、代码块、对象包装或任何 JSON 数组之外的文字。",
    "7. 禁止输出“原词 -> 修正词”、候选词列表、修正说明、差异摘要、原因分析、表格或局部修正清单。",
    "8. 即使你在内部识别出 ASR 错误、hotwords 或专有名词，也只能把修正结果写入对应字幕对象的 t 字段。",
    "",
    "【必须执行】",
    "1. 如果 verifiable_asr_candidates 中的 observed 在对应字幕行出现，且 suggested 有明确写法，必须优先修正为 suggested，除非上下文明确证明 suggested 不适用。",
    "2. 如果同一专有名词、称呼、英文词或模型名在上下文中有多种写法，必须统一为 hotwords/reference_terms 中更规范、更高频或更符合常识的写法。",
    "3. 输出前自检：ASR 候选是否处理、专有名词/称呼是否统一、是否引入了原文没有的新信息。",
    "",
    "【润色规则】",
    "1. 只修复有上下文、常识、专有名词、hotwords 或参考词支撑的 ASR/错别字/大小写/标点问题。",
    "2. 没有证据时保持原文，不要自由创造新事实，不要为了流畅而乱改。",
    "3. 不得改变原意、语气强度、字幕条数、字幕顺序和 s 字段。",
    "4. 输出必须是与输入等长的 JSON 数组，每项只包含 s 和 t。",
    "5. 如果某条字幕无法判断如何修正，保留该条 t 原文，不要在输出中解释原因。",
    "",
    "【Output】",
    "只输出最终完整合法 JSON 数组。",
    "禁止输出解释、markdown、代码块、候选词列表、对照表或“原词 -> 修正词”内容。",
    "输出必须包含输入中的全部字幕对象，且每个对象只包含原样保留的 s 和润色后的 t。",
    "",
    "【可验证 ASR/hotwords 参考】",
    JSON.stringify(asrContext, null, 2),
    "",
    "【待润色字幕 JSON】",
    JSON.stringify(subtitles, null, 2),
  ].join("\n");
}

function buildQualityPrompt(original, polished, asrContext, retryContext = null) {
  const retryLines = retryContext
    ? [
        "【自动重试纠偏】",
        "上一次质检输出无效，原因如下：",
        retryContext.reason || "未返回合法质检 JSON 或可解析分值。",
        "上一次输出预览：",
        retryContext.previousOutputPreview || "",
        "本次必须只输出一个合法 JSON 对象，且必须包含可解析的 total_score 数值。",
        "",
      ]
    : [];
  return [
    "你是字幕润色质量检测模型。请根据原文、润色结果和【可验证 ASR/hotwords 参考】进行评分。",
    "",
    ...retryLines,
    "【输出硬性格式，必须严格遵守】",
    "1. 只输出一个合法 JSON 对象，不要输出解释、markdown、代码块或额外文字。",
    "2. 必须包含 total_score，取值 0-100。",
    "3. 必须包含 subscores，且必须包含 structure、semantic_fidelity、asr_correction、terminology、polish_and_translation_readiness 五项。",
    "4. 必须包含 error_counts，且必须包含 critical_errors、structure_errors、semantic_errors、asr_errors、terminology_errors、over_polishing_errors、translation_errors。",
    "4.1 semantic_errors、asr_errors、terminology_errors 在本测试中表示 AI 质检识别到的风险点数量，不代表人工确认后的绝对错误数；计数应尽量避免同一问题重复归类。",
    "5. structure_errors 只统计硬结构错误：输出不是合法 JSON 数组、字幕条数变化、字幕对象与原文位置不再一一对应、同一位置的 s 字段变化、缺少 s/t 字段。额外字段不单独计入 structure_errors；只有额外字段导致缺少 s/t 或无法解析时才算结构问题。不要把断句不自然、句式不顺、语气变化、内容风险计入 structure_errors。",
    "6. 必须包含 production_decision，取值 recommended、backup、needs_review、not_recommended 之一；需要人工复核但不是直接不推荐时使用 needs_review。",
    "7. 必须包含 summary、weaknesses、representative_issues。",
    "",
    "【质检重点】",
    "1. 可验证 ASR 候选是否被正确修复；根据上下文、hotwords 或参考词把错误专有名词纠正为正确写法，应视为优点。",
    "2. hotwords、专有名词、大小写、数字格式是否一致；不要把有证据的专有名词纠正判为错误。",
    "3. 是否存在无依据扩写、自由创造事实、改变原意。",
    "4. 字幕条数、对象位置和 s 字段是否保持不变；这里的顺序只指字幕对象是否被重排，可用每个位置的 s 是否与原文一致判断。如果条数、每个位置的 s、每条 t 都正常，structure_errors 必须为 0。",
    "5. 没有证据的自由改写不能算优点，应按语义或过度润色问题扣分。",
    "6. 如果 verifiable_asr_candidates 中 observed 未被修正为 suggested，且上下文没有反证，应计入 ASR 或术语问题。",
    "7. critical_errors 只统计会导致交付不可用的重大错误，例如字幕结构破坏、大量错位、严重改意或关键事实完全错误；普通语义问题、ASR 未修、术语不统一不要计入 critical_errors。",
    "8. 专有名词、人物、称呼或术语被纠正为上下文更支持的正确写法，不是错误。只有在缺少证据时把原本正确的关键实体改成另一个明确错误实体，且影响核心理解，才计入 terminology_errors 或 semantic_errors 风险点；只有该问题影响关键事实或反复污染整段，才可计入 critical_errors。",
    "9. 断句、表达顺畅度、语气、文本自然度问题应计入 semantic_errors、over_polishing_errors 或 polish_and_translation_readiness 风险点，不要计入 structure_errors。",
    "",
    "【可验证 ASR/hotwords 参考】",
    JSON.stringify(asrContext, null, 2),
    "",
    "【字幕原文 JSON】",
    JSON.stringify(original, null, 2),
    "",
    "【润色结果 JSON】",
    JSON.stringify(polished, null, 2),
  ].join("\n");
}

function recordRuntimePayload(type, payload) {
  window.subtitlePolishDebugPayloads ||= { polish: [], quality: [] };
  const list = window.subtitlePolishDebugPayloads[type] || [];
  list.push(cloneJson(payload));
  if (list.length > 20) list.shift();
  window.subtitlePolishDebugPayloads[type] = list;
  console.info(`[subtitle-polish-demo] ${type} payload`, payload);
}

function buildAsrVerificationContext(subtitles) {
  const candidates = extractVerifiableAsrCandidates(subtitles);
  const hotwords = extractHotwords(subtitles);
  const referenceTerms = extractReferenceTerms(subtitles);
  return {
    purpose: "给润色模型提供可验证的 ASR 修复线索；没有证据时保持原文，不自由改写。",
    verifiable_asr_candidates: candidates,
    hotwords,
    reference_terms: referenceTerms,
    constraints: [
      "候选错误点仅作为优先核对线索，不代表必须全部修改。",
      "专有名词、产品名、人名、地名、数字、英文大小写需保持可验证一致。",
      "不能新增原字幕没有表达的信息；不能改变说话含义和语气强度。",
      "字幕条数、顺序和 s 字段必须与原文一致。",
    ],
  };
}

function splitSubtitleChunks(subtitles, size) {
  const rows = Array.isArray(subtitles) ? subtitles : [];
  const chunkSize = Math.max(1, Number(size) || rows.length || 1);
  const chunks = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const end = Math.min(rows.length, start + chunkSize);
    chunks.push({ start, end, rows: rows.slice(start, end) });
  }
  return chunks.length ? chunks : [{ start: 0, end: 0, rows: [] }];
}

function addUniqueTaskId(taskIds, taskId) {
  const value = String(taskId || "").trim();
  if (value && !taskIds.includes(value)) taskIds.push(value);
}

function formatTaskIds(taskIds) {
  const ids = (taskIds || []).filter(Boolean);
  if (!ids.length) return "";
  if (ids.length === 1) return ids[0];
  return `${ids[0]} 等${ids.length}个`;
}

function extractVerifiableAsrCandidates(subtitles) {
  const rules = knownAsrCorrectionRules();
  const candidates = [];
  subtitles.forEach((row, rowIndex) => {
    const text = String(row.t || "");
    rules.forEach((rule) => {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
      if (!pattern.test(text)) return;
      candidates.push({
        row: rowIndex + 1,
        s: row.s,
        observed: rule.observed,
        suggested: rule.suggested,
        evidence: rule.evidence,
        original_text: text,
      });
    });
  });
  return candidates.slice(0, 80);
}

function knownAsrCorrectionRules() {
  return [
    { pattern: /open\s*AI/gi, observed: "open AI", suggested: "OpenAI", evidence: "常见品牌名大小写" },
    { pattern: /差\s*gpt/gi, observed: "差 gpt", suggested: "ChatGPT", evidence: "常见产品名" },
    { pattern: /提示词公程/g, observed: "提示词公程", suggested: "提示词工程", evidence: "常见术语" },
    { pattern: /稳打稳章/g, observed: "稳打稳章", suggested: "稳扎稳打", evidence: "常见成语" },
    { pattern: /激 动/g, observed: "激 动", suggested: "激动", evidence: "异常空格" },
    { pattern: /梦 想/g, observed: "梦 想", suggested: "梦想", evidence: "异常空格" },
    { pattern: /很 漫长/g, observed: "很 漫长", suggested: "很漫长", evidence: "异常空格" },
    { pattern: /乌证峰会/g, observed: "乌证峰会", suggested: "乌镇峰会", evidence: "常见地名/会议名" },
    { pattern: /图壤/g, observed: "图壤", suggested: "土壤", evidence: "常见词" },
    { pattern: /智能产产/g, observed: "智能产产", suggested: "智能产品", evidence: "重复误识别" },
    { pattern: /答谢液/g, observed: "答谢液", suggested: "答谢宴", evidence: "常见词" },
    { pattern: /元始天子/g, observed: "元始天子", suggested: "元始天尊", evidence: "常见专名" },
    { pattern: /申公报|深公报/g, observed: "申公报/深公报", suggested: "申公豹", evidence: "常见专名" },
    { pattern: /九藤致基金/g, observed: "九藤致基金", suggested: "九头雉鸡精", evidence: "常见专名" },
    { pattern: /一石皮琶军/g, observed: "一石皮琶军", suggested: "玉石琵琶精", evidence: "常见专名" },
    { pattern: /its easy to doit easy to C/gi, observed: "its easy to doit easy to C", suggested: "It's easy to say", evidence: "英文 ASR 误识别候选" },
    { pattern: /GPT3\.54/g, observed: "GPT3.54", suggested: "GPT-3.5、GPT-4", evidence: "常见模型名格式" },
    { pattern: /deeps v3RO1/gi, observed: "deeps v3RO1", suggested: "DeepSeek V3、R1", evidence: "常见模型名格式" },
  ];
}

function extractHotwords(subtitles) {
  const text = subtitles.map((row) => row.t || "").join(" ");
  const terms = new Set();
  const patterns = [
    /\b[A-Z][A-Za-z0-9-]{1,}\b/g,
    /\b(?:GPT|ChatGPT|OpenAI|DeepSeek|Claude|Gemini|LLaMA|Qwen|Kimi|Doubao|Sora|API|ASR)\b/gi,
    /\b[a-zA-Z]+[- ]?\d+(?:\.\d+)?[a-zA-Z-]*\b/g,
    /\b\d+(?:\.\d+)?\s*(?:%|年|月|天|小时|分钟|秒|公里|米|元|美元|万|亿)\b/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[0] || "").trim();
      if (value.length >= 2) terms.add(value);
    }
  });
  return [...terms].slice(0, 120);
}

function extractReferenceTerms(subtitles) {
  const counts = new Map();
  subtitles.forEach((row) => {
    const text = String(row.t || "");
    const chunks = text.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
    chunks.forEach((chunk) => {
      if (/^[的是了我们你们他们这个那个因为所以然后但是如果可以进行一个没有]+$/.test(chunk)) return;
      counts.set(chunk, (counts.get(chunk) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 80)
    .map(([term, count]) => ({ term, count }));
}

function normalizePolishResponse(response) {
  const raw = parseMaybeJson(response);
  const payload = unwrapResponse(raw);
  const taskId = extractTaskId(raw) || extractTaskId(payload);
  const content = findSubtitleArrayPayload(pickFirstDefined(
    payload?.text,
    payload?.content,
    payload?.output,
    payload?.result,
    payload?.data?.text,
    payload?.data?.content,
    payload?.data?.output,
    payload?.data?.result,
    payload?.data,
    payload?.list,
    payload?.items,
    payload?.subtitles,
    payload?.polished_subtitles,
    payload?.translated_content,
    payload,
  ));
  const parsed = parseSubtitleArrayContent(content);
  if (!Array.isArray(parsed)) {
    throw new Error(`润色任务未返回字幕数组，请检查返回字段。返回预览：${previewResponseForError(content)}`);
  }
  const output = parsed.map((row, index) => {
    if (!row || !Object.prototype.hasOwnProperty.call(row, "s") || !Object.prototype.hasOwnProperty.call(row, "t")) {
      throw new Error(`润色结果第 ${index + 1} 行缺少 s 或 t 字段。`);
    }
    return { s: row.s, t: String(row.t ?? "") };
  });
  return { output, taskId };
}

function findSubtitleArrayPayload(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  const parsed = parseSubtitleArrayContent(value);
  if (Array.isArray(parsed)) {
    if (isSubtitleArray(parsed)) return parsed;
    for (const item of parsed) {
      const nested = findSubtitleArrayPayload(item, depth + 1);
      if (isSubtitleArray(nested)) return nested;
    }
    return parsed;
  }
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return parsed;

  const keys = [
    "text",
    "content",
    "output",
    "result",
    "answer",
    "message",
    "choices",
    "response",
    "payload",
    "records",
    "rows",
    "subtitles",
    "polished_subtitles",
    "translated_content",
    "list",
    "items",
    "data",
  ];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
    const nested = findSubtitleArrayPayload(parsed[key], depth + 1);
    if (Array.isArray(parseSubtitleArrayContent(nested))) return nested;
  }
  return parsed;
}

function parseSubtitleArrayContent(content) {
  const parsed = parseMaybeJson(content);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "string") return parsed;
  const text = cleanMarkdownCodeBlock(parsed);
  const direct = parseMaybeJson(text);
  if (Array.isArray(direct)) return direct;
  const extracted = extractJsonArraysFromText(text);
  const subtitleArrays = extracted.filter(isSubtitleArray);
  const subtitleArray = subtitleArrays[subtitleArrays.length - 1] || extracted[extracted.length - 1];
  if (Array.isArray(subtitleArray)) return subtitleArray;
  return parsed;
}

function isSubtitleArray(value) {
  return Array.isArray(value) && value.every((row) => row && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, "s") && Object.prototype.hasOwnProperty.call(row, "t"));
}

function extractJsonArraysFromText(text) {
  return extractJsonValuesFromText(text, "[", "]").filter(Array.isArray);
}

function extractJsonObjectsFromText(text) {
  return extractJsonValuesFromText(text, "{", "}").filter((value) => value && typeof value === "object" && !Array.isArray(value));
}

function extractJsonValuesFromText(text, openChar, closeChar) {
  const source = String(text || "");
  const values = [];
  for (let start = source.indexOf(openChar); start >= 0; start = source.indexOf(openChar, start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
      } else if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParseJson(source.slice(start, index + 1));
          if (parsed !== source.slice(start, index + 1)) values.push(parsed);
          break;
        }
      }
    }
  }
  return values;
}

function previewResponseForError(value) {
  try {
    return String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, 240);
  } catch {
    return String(value).slice(0, 240);
  }
}

function normalizeQualityResponse(response, templateId, judgeTemplateId) {
  const raw = parseMaybeJson(response);
  const payload = unwrapResponse(raw);
  const taskId = extractTaskId(raw) || extractTaskId(payload);
  const parsed = parseMaybeJson(payload);
  const report = extractQualityReport(parsed);
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("质检任务未返回质检 JSON 对象。");
  }
  const issueSource = report.representative_issues ?? report.issues ?? report.weaknesses ?? report.errors ?? report.problem_list ?? report.error_list;
  const totalScore = readNumber(report.total_score ?? report.score ?? report.total);
  const subscores = normalizeSubscores(report.subscores ?? report.score_detail ?? report.dimensions);
  const displayRawResult = sanitizeQualityRawResult(report);
  return {
    taskId: taskId || extractTaskId(report),
    report: {
    total_score: totalScore,
    score_parse_error: totalScore == null ? "质检结果未返回可解析的 total_score/score/total 字段。" : "",
    subscores,
    error_counts: normalizeErrorCounts(report.error_counts ?? report.errors_count ?? report.errorCounts, report),
    ...(report.production_risk ? { production_risk: report.production_risk } : {}),
    production_decision: normalizeProductionDecision(report.production_decision ?? report.decision ?? "unknown"),
    summary: report.summary ?? report.final_reason ?? report.reason ?? "",
    weaknesses: normalizeList(report.weaknesses ?? issueSource),
    representative_issues: normalizeList(issueSource),
    raw_result: displayRawResult,
    },
  };
}

function sanitizeQualityRawResult(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const output = { ...report };
  delete output.final_winner;
  delete output.winner;
  delete output.candidate;
  delete output.confidence;
  delete output.judge_template_id;
  return output;
}

function extractTaskId(value) {
  const parsed = parseMaybeJson(value);
  if (!parsed || typeof parsed !== "object") return "";
  const direct = parsed.task_id ?? parsed.taskId ?? parsed.taskid ?? parsed.taskID ?? parsed.task_id_str ?? parsed.taskIdStr ?? parsed.id;
  if (direct != null && direct !== "") return String(direct);
  const containers = [parsed.data, parsed.result, parsed.output, parsed.content, parsed.report];
  for (const item of containers) {
    const nested = extractTaskId(item);
    if (nested) return nested;
  }
  return "";
}

function extractQualityReport(parsed) {
  const candidates = [
    parsed.text,
    parsed.result,
    parsed.report,
    parsed.output,
    parsed.content,
    parsed.data?.text,
    parsed.data,
    parsed.answer,
    parsed.message,
    parsed,
  ];
  for (const candidate of candidates) {
    const value = parseMaybeJson(candidate);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.result && typeof value.result === "string") {
        const nested = parseMaybeJson(value.result);
        if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
      }
      return value;
    }
    if (typeof value === "string") {
      const objects = extractJsonObjectsFromText(cleanMarkdownCodeBlock(value));
      const report = objects.slice().reverse().find((item) => readNumber(item.total_score ?? item.score ?? item.total) != null) || objects[objects.length - 1];
      if (report) return report;
      const score = extractScoreFromText(value);
      if (score != null) {
        return {
          total_score: score,
          summary: "质检模型返回了文本分值，但未返回标准 JSON 明细；建议重试或调整质检模板输出 JSON。",
          representative_issues: [cleanMarkdownCodeBlock(value).slice(0, 500)],
        };
      }
    }
  }
  return null;
}

function normalizeSubscores(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    structure: readNumber(source.structure ?? source.structure_stability),
    semantic_fidelity: readNumber(source.semantic_fidelity ?? source.semantic),
    asr_correction: readNumber(source.asr_correction ?? source.asr),
    terminology: readNumber(source.terminology ?? source.term),
    polish_and_translation_readiness: readNumber(source.polish_and_translation_readiness ?? source.polish ?? source.translation_readiness),
  };
}

function readNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  if (typeof value === "string") return extractScoreFromText(value);
  return null;
}

function extractScoreFromText(text) {
  const value = String(text || "");
  const patterns = [
    /(?:total_score|score|total|总分|质检分|评分)\s*[:：=]?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*100|\s*分)?/i,
    /(\d+(?:\.\d+)?)\s*\/\s*100/,
    /(\d+(?:\.\d+)?)\s*分/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isFinite(number) && number >= 0 && number <= 100) return number;
  }
  return null;
}

function normalizeErrorCounts(value, report = {}) {
  const source = value && typeof value === "object" ? value : {};
  const direct = report && typeof report === "object" ? report : {};
  const semanticFromIssues = countIssuesByCategory(direct, [
    "semantic", "meaning", "fidelity", "meaning_changed", "rewrite_meaning",
    "语义", "改意", "意思改变", "忠实度", "语义一致",
  ]);
  const asrFromIssues = countIssuesByCategory(direct, [
    "asr", "speech", "recognition", "homophone", "misheard",
    "ASR", "asr", "错听", "识别", "同音", "错别字",
  ]);
  const terminologyFromIssues = countIssuesByCategory(direct, [
    "terminology", "term", "proper_noun", "name", "glossary",
    "术语", "专有名词", "名词", "人名", "地名",
  ]);
  return {
    critical_errors: readCount(source, direct, [
      "critical_errors", "criticalErrors", "critical_error_count", "criticalErrorCount",
      "严重错误数", "严重错误_count",
    ]),
    structure_errors: readCount(source, direct, [
      "structure_errors", "structure", "structureErrors", "structure_error_count",
      "format_errors", "json_structure_errors", "subtitle_structure_errors",
      "structure_issues", "format_issues", "json_structure_issues", "subtitle_structure_issues",
      "结构错误", "结构错误数", "格式错误", "字幕结构错误",
    ]),
    semantic_errors: Math.max(readCount(source, direct, [
      "semantic_errors", "semantic", "semanticErrors", "semantic_error_count",
      "meaning_errors", "meaning_changed_errors", "fidelity_errors",
      "semantic_issues", "meaning_issues", "meaning_changed_issues", "fidelity_issues",
      "语义错误", "语义错误数", "改意错误", "意思改变",
    ]), semanticFromIssues),
    asr_errors: Math.max(readCount(source, direct, [
      "asr_errors", "asr", "asrErrors", "asr_error_count",
      "speech_recognition_errors", "recognition_errors",
      "asr_issues", "speech_recognition_issues", "recognition_issues",
      "ASR错误", "asr错误", "错听错误", "识别错误",
    ]), asrFromIssues),
    terminology_errors: Math.max(readCount(source, direct, [
      "terminology_errors", "terminology", "term", "term_errors", "terminologyErrors",
      "proper_noun_errors", "name_errors",
      "terminology_issues", "term_issues", "proper_noun_issues", "name_issues",
      "术语错误", "术语错误数", "专有名词错误", "名词错误",
    ]), terminologyFromIssues),
    over_polishing_errors: readCount(source, direct, [
      "over_polishing_errors", "over_polishing", "overPolishingErrors",
      "over_rewrite_errors", "over_optimization_errors",
      "过度润色错误", "过度改写错误",
    ]),
    translation_errors: readCount(source, direct, [
      "translation_errors", "translation", "translationErrors",
      "mistranslation_errors", "翻译错误", "误译错误",
    ]),
  };
}

function readCount(source, fallback, aliases) {
  for (const key of aliases) {
    const value = source?.[key] ?? fallback?.[key];
    const count = normalizeCountValue(value);
    if (count != null) return count;
  }
  return 0;
}

function normalizeCountValue(value) {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countIssuesByCategory(report, keywords) {
  const issues = collectIssueObjects(report);
  return issues.filter((issue) => matchesIssueCategory(issue, keywords)).length;
}

function collectIssueObjects(report) {
  return []
    .concat(Array.isArray(report?.issues) ? report.issues : [])
    .concat(Array.isArray(report?.representative_issues) ? report.representative_issues : [])
    .concat(Array.isArray(report?.errors) ? report.errors : [])
    .concat(Array.isArray(report?.problem_list) ? report.problem_list : [])
    .concat(Array.isArray(report?.error_list) ? report.error_list : []);
}

function matchesIssueCategory(issue, keywords) {
  const text = issueSearchText(issue);
  return keywords.some((keyword) => text.includes(String(keyword).toLowerCase()));
}

function issueSearchText(issue) {
  if (typeof issue === "string") return issue.toLowerCase();
  if (!issue || typeof issue !== "object") return "";
  return [
    issue.category,
    issue.type,
    issue.dimension,
    issue.field,
    issue.error_type,
    issue.errorType,
    issue.label,
    issue.message,
    issue.description,
    issue.reason,
    issue.issue,
    issue.problem,
    issue.text,
    issue.content,
    issue.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function unwrapResponse(response) {
  if (response && typeof response === "object") {
    return response.data ?? response.result ?? response.output ?? response;
  }
  return response;
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function parseMaybeJson(value) {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    if (typeof current !== "string") return current;
    const parsed = tryParseJson(current);
    if (parsed === current) return current;
    current = parsed;
  }
  return current;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(issueText).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function issueText(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const text = item.message ?? item.description ?? item.reason ?? item.issue ?? item.problem ?? item.text ?? item.content ?? item.summary;
  if (text) return String(text).trim();
  return JSON.stringify(item);
}

function buildExportFiles(files) {
  const folder = `${baseFileName(state.uploadedFileName)}_原文_润色_质检`;
  const exportFiles = [];
  files.forEach((file) => {
    exportFiles.push({
      name: `${folder}/${file.index}原文.json`,
      content: pretty(file.subtitles),
    });
    exportFiles.push({
      name: `${folder}/${file.index}润色.json`,
      content: pretty(buildPolishExport(file)),
    });
    exportFiles.push({
      name: `${folder}/${file.index}润色质量检测结果.json`,
      content: pretty(buildQualityExport(file)),
    });
  });
  return { folder, exportFiles };
}

function buildPolishExport(file) {
  const result = {};
  state.templates.forEach((templateId) => {
    const polish = file.polish[templateId];
    result[templateId] = polish
      ? {
          status: polish.status,
          taskid: polish.taskId || "",
          taskids: polish.taskIds || [],
          auto_retried: Boolean(polish.autoRetried),
          structure_ok: Boolean(polish.structureOk),
          effectiveness: polish.output ? analyzePolishEffectiveness(file.subtitles, polish.output) : null,
          error: polish.error || "",
          content: polish.output || null,
        }
      : {
          status: "not_polished",
          structure_ok: false,
          error: "",
          content: null,
        };
  });
  return result;
}

function buildQualityExport(file) {
  const result = {};
  state.templates.forEach((templateId) => {
    const quality = file.quality[templateId];
    result[templateId] = quality
      ? {
          status: quality.status,
          taskid: quality.taskId || "",
          auto_retried: Boolean(quality.autoRetried),
          error: quality.error || "",
          result: quality.report || null,
        }
      : {
          status: "not_checked",
          error: "",
          result: null,
        };
  });
  return result;
}

function exportSelectedFiles() {
  const files = selectedFiles();
  if (!files.length) {
    showToast("请先勾选需要导出的小文件。");
    return;
  }
  const { folder, exportFiles } = buildExportFiles(files);
  const zipBlob = createZip(exportFiles);
  downloadBlob(zipBlob, `${folder}.zip`);
  showToast(`已导出 ${files.length} 个小文件，共 ${exportFiles.length} 个结果文件。`);
}

function exportMergedFiles() {
  const files = state.files.filter((file) => !file.parseError);
  if (!files.length) {
    showToast("请先上传需要合并导出的 JSON 文件。");
    return;
  }

  const folder = `${baseFileName(state.uploadedFileName)}_合并文件导出`;
  const exportFiles = [
    {
      name: `${folder}/${baseFileName(state.uploadedFileName)}_原文_合并.txt`,
      content: buildMergedSubtitleText(files, (file) => file.subtitles),
    },
  ];

  state.templates.forEach((templateId, index) => {
    const label = templateId ? safeFileName(templateId) : `未填写润色模板ID_${index + 1}`;
    exportFiles.push({
      name: `${folder}/润色模板${index + 1}_${label}_润色合并.txt`,
      content: buildMergedSubtitleText(files, (file) => {
        const polish = file.polish[templateId];
        return polish?.status === "success" && Array.isArray(polish.output) ? polish.output : file.subtitles;
      }),
    });
  });

  exportFiles.push({
    name: `${folder}/${baseFileName(state.uploadedFileName)}_润色质量检测结果_合并.txt`,
    content: buildMergedQualityText(files),
  });

  const zipBlob = createZip(exportFiles);
  downloadBlob(zipBlob, `${folder}.zip`);
  showToast(`已导出原文、${state.templates.length} 个润色模板和质检结果的合并 TXT。`);
}

function buildMergedJsonContent(fileArrays) {
  return JSON.stringify(fileArrays.map((items) => JSON.stringify(items)), null, 2);
}

function buildMergedSubtitleText(files, getSubtitles) {
  return files
    .map((file, index) => {
      const subtitles = normalizeSubtitleArray(getSubtitles(file));
      const lines = [`file${index + 1}`];
      subtitles.forEach((item) => {
        lines.push(`s:${formatSubtitleValue(item?.s)}`);
        lines.push(`t:${formatSubtitleValue(item?.t)}`);
      });
      return lines.join("\n");
    })
    .join("\n\n");
}

function normalizeSubtitleArray(value) {
  if (Array.isArray(value)) return value;
  const parsed = parseMaybeJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function formatSubtitleValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function buildMergedQualityText(files) {
  const result = {};
  files.forEach((file, index) => {
    result[`file${index + 1}`] = buildQualityExport(file);
  });
  return pretty(result);
}

function safeFileName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 80)
    .trim() || "未命名";
}

function downloadConclusionTable() {
  const rows = buildConclusionRows();
  if (!rows.length) {
    showToast("暂无可下载结论，请先完成润色质检检测。");
    return;
  }

  const filename = `${baseFileName(state.uploadedFileName)}_模型核心数据对比表.xls`;
  const html = buildConclusionWorkbookHtml(rows);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, filename);
  showToast(`已下载 ${rows.length} 个模型的核心数据对比表。`);
}

function buildConclusionRows() {
  const files = selectedFiles();
  const pairwise = buildPairwiseEvaluations(files);
  const rows = state.templates
    .map((templateId) => {
      const reports = files
        .map((file) => file.quality[templateId])
        .filter((quality) => quality?.status === "success" && quality.report)
        .map((quality) => quality.report)
        .filter((report) => Number.isFinite(report.total_score));
      if (!reports.length) return null;

      const errorTotals = reports.reduce(
        (acc, report) => {
          const counts = report.error_counts || {};
          acc.criticalErrors += counts.critical_errors || 0;
          acc.structureErrors += counts.structure_errors || 0;
          acc.semanticErrors += counts.semantic_errors || 0;
          acc.asrErrors += counts.asr_errors || 0;
          acc.terminologyErrors += counts.terminology_errors || 0;
          return acc;
        },
        {
          criticalErrors: 0,
          structureErrors: 0,
          semanticErrors: 0,
          asrErrors: 0,
          terminologyErrors: 0,
        },
      );
      const totalScore = reports.reduce((sum, report) => sum + report.total_score, 0) / reports.length;
      const pairwiseStats = pairwise.byTemplate.get(templateId) || {};
      return {
        model: templateId,
        totalScore: Math.round(totalScore),
        productionDecision: decisionText(summarizeDecision(reports)),
        mainReason: summarizeMainReason(templateId, reports, errorTotals),
        selectedCount: files.length,
        reportsCount: reports.length,
        effectiveWins: pairwiseStats.effectiveWins || 0,
        pairwiseWins: pairwiseStats.pairwiseWins || 0,
        pairwiseTies: pairwiseStats.pairwiseTies || 0,
        pairwiseLosses: pairwiseStats.pairwiseLosses || 0,
        highWins: pairwiseStats.highWins || 0,
        ...errorTotals,
      };
    })
    .filter(Boolean)
    .sort(compareConclusionRows);
  return rows;
}

function compareConclusionRows(a, b) {
  const decisionWeight = { 建议使用: 0, 可作为备选: 1, 确认后使用: 2, 暂不建议使用: 3 };
  return (
    b.totalScore - a.totalScore ||
    a.criticalErrors - b.criticalErrors ||
    a.structureErrors - b.structureErrors ||
    b.highWins - a.highWins ||
    b.effectiveWins - a.effectiveWins ||
    (decisionWeight[a.productionDecision] ?? 9) - (decisionWeight[b.productionDecision] ?? 9) ||
    a.semanticErrors - b.semanticErrors ||
    a.terminologyErrors - b.terminologyErrors ||
    a.asrErrors - b.asrErrors
  );
}

function summarizeMainReason(templateId, reports, errorTotals) {
  if (errorTotals.criticalErrors > 0) return "存在严重错误，需优先复核高风险样本。";
  if (errorTotals.structureErrors > 0) return "存在结构硬错误，需确认字幕条数、顺序、s 字段和 JSON 结构。";
  if (errorTotals.semanticErrors > 0) return "存在语义修改风险点，建议抽查是否改变原意。";
  if (errorTotals.asrErrors > 0) return "存在 ASR 修正风险点，建议复核错别字、同音误识别和断句。";
  if (errorTotals.terminologyErrors > 0) return "存在术语风险点，建议复核专有名词和称呼一致性。";
  const summaries = reports
    .map((report) => report.summary)
    .filter(Boolean);
  return summaries[0] || `${templateId} 综合表现稳定，当前测试样本中未发现明显高风险问题。`;
}

function buildConclusionWorkbookHtml(rows) {
  const header = ["模型", "勾选样本数", "已质检样本数", "总分", "胜出权重", "赢/平/输", "高区分胜场", "严重错误", "结构硬错误", "语义风险点", "ASR 风险点", "术语风险点", "汇总建议", "主要原因"];
  const bodyRows = rows
    .map((row) => [
      row.model,
      row.selectedCount,
      row.reportsCount,
      row.totalScore,
      formatNumber(row.effectiveWins),
      `赢${row.pairwiseWins} 平${row.pairwiseTies} 输${row.pairwiseLosses}`,
      row.highWins,
      row.criticalErrors,
      row.structureErrors,
      row.semanticErrors,
      row.asrErrors,
      row.terminologyErrors,
      row.productionDecision,
      row.mainReason,
    ])
    .map((cells) => `<tr>${cells.map((cell, index) => `<td${index === 5 ? ' class="text-cell"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const conclusionRow = buildConclusionWorkbookSummaryRow(rows, header.length);

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d9e2ec; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; font-weight: 700; }
    .number { mso-number-format:"0"; }
    .text-cell { mso-number-format:"\\@"; }
    .conclusion-row { font-weight: 700; background: #fff7df; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${bodyRows}
      ${conclusionRow}
    </tbody>
  </table>
</body>
</html>`;
}

function buildConclusionWorkbookSummaryRow(rows, colspan) {
  const text = buildConclusionTableSummary(rows);
  if (!text) return "";
  return `<tr><td colspan="${colspan}" class="conclusion-row">${escapeHtml(text)}</td></tr>`;
}

function buildConclusionTableSummary(rows) {
  if (!rows.length) return "";
  const top = rows[0];
  const second = rows[1];
  if (!second) return `结论：当前仅 ${displayTemplateId(top.model)} 有有效结果，暂不能做模型对比。`;
  if (top.totalScore === second.totalScore) {
    return `结论：${displayTemplateId(top.model)} 和 ${displayTemplateId(second.model)} 当前打平，平均分均为 ${top.totalScore}，建议抽查差异样本后再定。`;
  }
  return `结论：建议优先选择 ${displayTemplateId(top.model)}，平均分 ${top.totalScore} 高于 ${displayTemplateId(second.model)} 的 ${second.totalScore}。`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const localHeader = concatBytes(
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    );
    const centralHeader = concatBytes(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    );
    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = concatBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  );
  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function crc32(bytes) {
  let crc = -1;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
})();

function inspectStructure(original, output) {
  const errors = [];
  if (!Array.isArray(output)) errors.push("输出不是数组。");
  if (Array.isArray(output) && output.length !== original.length) {
    errors.push(`字幕条目数量不一致：原始 ${original.length}，输出 ${output.length}。`);
  }
  if (Array.isArray(output)) {
    const len = Math.min(original.length, output.length);
    for (let index = 0; index < len; index += 1) {
      if (original[index].s !== output[index].s) {
        errors.push(`第 ${index + 1} 行 s 字段被修改。`);
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function refreshFileStatus(file) {
  const polishResults = state.templates.map((id) => file.polish[id]).filter(Boolean);
  if (polishResults.some((result) => result.status === "running")) {
    file.polishStatus = "running";
  } else if (polishResults.some((result) => result.status === "failed")) {
    file.polishStatus = "failed";
  } else if (polishResults.length && polishResults.every((result) => result.status === "success")) {
    file.polishStatus = "success";
  } else {
    file.polishStatus = "idle";
  }

  if (polishResults.length && polishResults.every((result) => result.structureOk)) {
    file.structureStatus = "ok";
  } else if (polishResults.some((result) => result.status === "failed" || result.structureOk === false)) {
    file.structureStatus = "bad";
  } else {
    file.structureStatus = "unchecked";
  }

  const qualityResults = state.templates.map((id) => file.quality[id]).filter(Boolean);
  if (qualityResults.some((result) => result.status === "running")) {
    file.checkStatus = "running";
  } else if (qualityResults.some((result) => result.status === "failed")) {
    file.checkStatus = "failed";
  } else if (qualityResults.length && qualityResults.every((result) => result.status === "success")) {
    file.checkStatus = "success";
  } else {
    file.checkStatus = "idle";
  }
}

function refreshAggregateFileStatuses() {
  state.files.forEach(refreshFileStatus);
}

function calculateTemplateAverages() {
  const map = new Map();
  const files = selectedFiles();
  state.templates.forEach((templateId) => {
    const scores = files
      .map((file) => file.quality[templateId]?.report?.total_score)
      .filter((score) => Number.isFinite(score));
    map.set(templateId, scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null);
  });
  return map;
}

function calculateRankings(files = selectedFiles()) {
  return state.templates
    .map((templateId) => {
      const reports = files
        .map((file) => file.quality[templateId]?.report)
        .filter((report) => report && Number.isFinite(report.total_score));
      if (!reports.length) return null;
      const avgScore = reports.reduce((sum, report) => sum + report.total_score, 0) / reports.length;
      const errors = reports.reduce(
        (acc, report) => {
          acc.criticalErrors += report.error_counts.critical_errors || 0;
          acc.structureErrors += report.error_counts.structure_errors || 0;
          acc.semanticErrors += report.error_counts.semantic_errors || 0;
          acc.asrErrors += report.error_counts.asr_errors || 0;
          acc.terminologyErrors += report.error_counts.terminology_errors || 0;
          return acc;
        },
        { criticalErrors: 0, structureErrors: 0, semanticErrors: 0, asrErrors: 0, terminologyErrors: 0 },
      );
      return {
        templateId,
        avgScore,
        reportsCount: reports.length,
        productionDecision: summarizeDecision(reports),
        productionRisk: summarizeRisk(reports),
        ...errors,
      };
    })
    .filter(Boolean)
    .sort(compareRanking);
}

function compareRanking(a, b) {
  const decisionWeight = { recommended: 0, backup: 1, needs_review: 2, not_recommended: 3 };
  const riskWeight = { low: 0, medium: 1, high: 2 };
  return (
    (decisionWeight[a.productionDecision] ?? 9) - (decisionWeight[b.productionDecision] ?? 9) ||
    a.criticalErrors - b.criticalErrors ||
    a.structureErrors - b.structureErrors ||
    a.semanticErrors - b.semanticErrors ||
    a.asrErrors - b.asrErrors ||
    a.terminologyErrors - b.terminologyErrors ||
    b.avgScore - a.avgScore ||
    (riskWeight[a.productionRisk] ?? 9) - (riskWeight[b.productionRisk] ?? 9)
  );
}

function summarizeDecision(reports) {
  const decisions = reports.map((report) => normalizeProductionDecision(report.production_decision));
  if (decisions.includes("not_recommended")) return "not_recommended";
  if (decisions.includes("needs_review")) return "needs_review";
  if (decisions.includes("backup")) return "backup";
  return "recommended";
}

function summarizeRisk(reports) {
  if (reports.some((report) => report.production_risk === "high")) return "high";
  if (reports.some((report) => report.production_risk === "medium")) return "medium";
  return "low";
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const records = parseUploadedPayload(text);
    state.files = records;
    state.selectedFileId = records[0]?.id || null;
    state.uploadedFileName = file.name;
    showToast(`上传成功：解析 ${records.length} 个小文件。`);
  } catch (error) {
    state.files = [];
    state.selectedFileId = null;
    state.uploadedFileName = "";
    showToast(error.message || "上传解析失败。");
  }
  render();
});

els.selectAllInput.addEventListener("change", () => {
  state.files.forEach((file) => {
    file.checked = els.selectAllInput.checked;
  });
  render();
});

els.addTemplateBtn.addEventListener("click", addTemplate);
els.judgeTemplateInput.addEventListener("change", () => {
  state.judgeTemplate = els.judgeTemplateInput.value.trim();
  state.files.forEach((file) => {
    file.quality = {};
    refreshFileStatus(file);
  });
  showToast("质检模板 ID 已变更，请重新质检。");
  render();
});
els.batchPolishBtn.addEventListener("click", () => runPolishForFiles(selectedFiles()));
els.batchCheckBtn.addEventListener("click", () => runCheckForFiles(selectedFiles()));
els.exportBtn.addEventListener("click", exportSelectedFiles);
els.mergedExportBtn.addEventListener("click", exportMergedFiles);
els.conclusionDownloadBtn.addEventListener("click", downloadConclusionTable);
els.clearBtn?.addEventListener("click", () => {
  state = {
    templates: [...defaultTemplates],
    judgeTemplate: defaultJudgeTemplate,
    files: [],
    selectedFileId: null,
    uploadedFileName: "",
  };
  els.fileInput.value = "";
  render();
  showToast("已恢复默认状态。");
});
els.copyOriginalBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.originalView.textContent);
    showToast("字幕原文已复制。");
  } catch {
    showToast("复制失败，请手动复制。");
  }
});

render();
