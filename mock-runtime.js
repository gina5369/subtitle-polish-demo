(function () {
  window.subtitlePolishMockRuntime = true;

  const replacements = [
    [/open\s*ai/gi, "OpenAI"],
    [/chat\s*gpt|差\s*gpt/gi, "ChatGPT"],
    [/提示词公程/g, "提示词工程"],
    [/稳打稳章/g, "稳扎稳打"],
    [/激 动/g, "激动"],
    [/梦 想/g, "梦想"],
    [/很 漫长/g, "很漫长"],
    [/乌证峰会/g, "乌镇峰会"],
    [/图壤/g, "土壤"],
    [/智能产产/g, "智能产品"],
    [/答谢液/g, "答谢宴"],
    [/元始天子/g, "元始天尊"],
    [/申公报|深公报/g, "申公豹"],
    [/九藤致基金/g, "九头雉鸡精"],
    [/一石皮琶军/g, "玉石琵琶精"],
    [/GPT3\.54/g, "GPT-3.5、GPT-4"],
    [/deeps v3RO1/gi, "DeepSeek V3、R1"],
  ];

  function hash(text) {
    return String(text || "").split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  }

  function polishText(text, templateId) {
    let output = String(text || "").replace(/\s+/g, " ").trim();
    replacements.forEach(([pattern, value]) => {
      output = output.replace(pattern, value);
    });
    if (hash(templateId) % 2 === 0) {
      output = output.replace(/^呃[，,]?\s*/, "").replace(/^嗯[，,]?\s*/, "");
    }
    if (output && /[\u4e00-\u9fa5]$/.test(output) && !/[。！？!?]$/.test(output) && hash(templateId) % 3 === 0) {
      output += "。";
    }
    return output;
  }

  function inspectStructure(original, output) {
    if (!Array.isArray(output) || output.length !== original.length) return false;
    return output.every((row, index) => row && row.s === original[index].s && Object.prototype.hasOwnProperty.call(row, "t"));
  }

  function changedRows(original, output) {
    return original.reduce((count, row, index) => count + (String(row.t || "").trim() !== String(output[index]?.t || "").trim() ? 1 : 0), 0);
  }

  function countRemainingAsr(output) {
    const text = output.map((row) => row.t || "").join("\n");
    return replacements.reduce((count, [pattern]) => count + (pattern.test(text) ? 1 : 0), 0);
  }

  window.subtitlePolishRuntime = {
    polish: async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 160));
      return {
        task_id: `mock-polish-${payload.file_index}-${hash(payload.template_id).toString(16).slice(0, 8)}`,
        data: payload.subtitles.map((row) => ({
          s: row.s,
          t: polishText(row.t, payload.template_id),
        })),
      };
    },

    qualityCheck: async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const original = payload.original_subtitles || [];
      const polished = payload.polished_subtitles || [];
      const structureOk = inspectStructure(original, polished);
      const changed = structureOk ? changedRows(original, polished) : 0;
      const remainingAsr = structureOk ? countRemainingAsr(polished) : 3;
      const templateBias = hash(payload.polish_template_id) % 5;
      const total = Math.max(60, Math.min(98, 86 + templateBias + Math.min(6, changed) - remainingAsr * 2 - (structureOk ? 0 : 20)));
      return {
        task_id: `mock-quality-${payload.file_index}-${hash(`${payload.template_id}-${payload.polish_template_id}`).toString(16).slice(0, 8)}`,
        final_winner: payload.polish_template_id,
        confidence: total >= 90 ? "high" : "medium",
        judge_template_id: payload.template_id,
        candidate: payload.polish_template_id,
        total_score: total,
        subscores: {
          structure: structureOk ? 20 : 5,
          semantic_fidelity: structureOk ? 23 : 12,
          asr_correction: Math.max(10, 20 - remainingAsr * 2),
          terminology: Math.max(10, 19 - remainingAsr),
          polish_and_translation_readiness: Math.max(10, total - 72),
        },
        error_counts: {
          critical_errors: structureOk ? 0 : 1,
          structure_errors: structureOk ? 0 : 1,
          semantic_errors: 0,
          asr_errors: remainingAsr,
          terminology_errors: Math.min(remainingAsr, 2),
          over_polishing_errors: 0,
          translation_errors: 0,
        },
        production_risk: total >= 88 ? "low" : "medium",
        production_decision: total >= 88 ? "recommended" : "backup",
        summary: "本地联调结果，仅用于检查 demo 交互，不代表真实模型结论。",
        weaknesses: remainingAsr ? ["仍有可疑 ASR 或术语点需要复核。"] : ["本地联调未发现明显结构问题。"],
      };
    },
  };

  window.addEventListener("DOMContentLoaded", () => {
    const banner = document.createElement("div");
    banner.className = "mock-banner";
    banner.textContent = "本地联调模式：当前结果为模拟数据，仅用于检查 demo 页面流程，不能作为真实模型结论。";
    document.body.prepend(banner);
  });
})();
