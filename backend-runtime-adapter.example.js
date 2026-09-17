// Example adapter for the RecCloud dev page.
// Replace existingTemplateRunner with the existing backend method that runs a template by ID.

window.subtitlePolishRuntime = {
  polish: async (payload) => {
    return existingTemplateRunner({
      templateId: payload.template_id,
      input: payload.prompt,
      subtitles: payload.subtitles,
      subtitleLen: payload.subtitle_len,
      fileIndex: payload.file_index,
    });
  },

  qualityCheck: async (payload) => {
    return existingTemplateRunner({
      templateId: payload.template_id,
      input: payload.prompt,
      polishTemplateId: payload.polish_template_id,
      originalSubtitles: payload.original_subtitles,
      polishedSubtitles: payload.polished_subtitles,
      subtitleLen: payload.subtitle_len,
      fileIndex: payload.file_index,
    });
  },
};
