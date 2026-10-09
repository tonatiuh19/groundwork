import { describe, expect, it } from "vitest";
import { transcriptTextFromTwilioSentences, twilioTranscriptionErrorCode } from "./index";

describe("Twilio v3 call transcripts", () => {
  it("labels channel 1 Caller / 2 Agent and orders by start time", () => {
    const text = transcriptTextFromTwilioSentences([
      { text: "Ok.", audioChannelIndex: 2, startTimeSeconds: 4.2, sentenceIndex: 1 },
      { text: "Ahorita ya te debió haber llegado el correo.", audioChannelIndex: 1, startTimeSeconds: 1.0, sentenceIndex: 0 },
      { text: "   ", audioChannelIndex: 1, startTimeSeconds: 5 },
      { text: "Gracias", audio_channel_index: 9, start_time: 6 },
    ]);
    expect(text).toBe("Caller: Ahorita ya te debió haber llegado el correo.\nAgent: Ok.\nGracias");
    expect(transcriptTextFromTwilioSentences(null)).toBe("");
  });

  it("maps the AI addendum error separately from generic failures", () => {
    expect(twilioTranscriptionErrorCode(200, {})).toBeNull();
    expect(twilioTranscriptionErrorCode(403, { code: 46009 })).toBe("twilio_ai_addendum");
    expect(twilioTranscriptionErrorCode(403, { message: "Please accept the AI addendum" })).toBe("twilio_ai_addendum");
    expect(twilioTranscriptionErrorCode(500, { message: "boom" })).toBe("twilio_stt_failed");
  });
});
