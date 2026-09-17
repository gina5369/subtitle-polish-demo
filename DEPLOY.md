# Subtitle Polish Demo Deploy Notes

## Where to place it

Put this folder under the RecCloud dev web app/static hosting, for example:

`https://dev-reccloud-ai.aoscdn.com/subtitle_polish_demo/index.html`

Do not test the real model flow from `file:///.../index.html`, because a local file page cannot access the backend template runtime by template ID alone.

## Runtime contract

The page already reads subtitle polish template IDs and the quality-check template ID from the UI. The backend page only needs to expose the existing template execution ability to the demo:

```js
window.subtitlePolishRuntime = {
  polish: async (payload) => {
    return await existingTemplateRunner({
      templateId: payload.template_id,
      input: payload.prompt,
      subtitles: payload.subtitles,
    });
  },

  qualityCheck: async (payload) => {
    return await existingTemplateRunner({
      templateId: payload.template_id,
      input: payload.prompt,
      originalSubtitles: payload.original_subtitles,
      polishedSubtitles: payload.polished_subtitles,
      polishTemplateId: payload.polish_template_id,
    });
  },
};
```

This is not a new model flow. It is only an adapter from the demo page to the existing backend template-ID execution flow.

## Expected returns

Polish should return a subtitle JSON array:

```json
[
  { "s": 0, "t": "polished subtitle text" }
]
```

Quality check should return a JSON object:

```json
{
  "total_score": 92,
  "subscores": {
    "structure": 20,
    "semantic_fidelity": 24,
    "asr_correction": 18,
    "terminology": 17,
    "polish_and_translation_readiness": 13
  },
  "error_counts": {
    "critical_errors": 0,
    "structure_errors": 0,
    "semantic_errors": 1,
    "asr_errors": 2,
    "terminology_errors": 1
  },
  "production_decision": "recommended",
  "summary": "overall result",
  "weaknesses": []
}
```
