import { describe, expect, it } from "vitest";
import { parseTwilioTranscriptPayload, transcriptTextFromTwilioSentences, twilioTranscriptionErrorCode } from "./index";

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

  it("labels speakers from participants (outbound browser calls put the agent on channel 1)", () => {
    const text = transcriptTextFromTwilioSentences(
      [
        { text: "Hi, this is Daniel from Groundwork.", audioChannelIndex: 1, startTimeSeconds: 0 },
        { text: "Hola Daniel.", audioChannelIndex: 2, startTimeSeconds: 2 },
      ],
      [
        { address: "client:admin_1", audioChannelIndex: 1, type: "CUSTOMER" },
        { address: "+17605550100", audioChannelIndex: 2, type: "HUMAN_AGENT" },
      ],
    );
    expect(text).toBe("Agent: Hi, this is Daniel from Groundwork.\nCaller: Hola Daniel.");
  });

  it("parses webhook / job payloads (top-level, nested, operationId)", () => {
    const sentences = [{ text: "Hello", audioChannelIndex: 1, startTimeSeconds: 0 }];
    const nested = parseTwilioTranscriptPayload({
      operationId: "voice_transcription_abc123",
      status: "COMPLETED",
      transcription: { id: "voice_transcription_abc123", sourceId: "RE" + "a".repeat(32), accountId: "AC1", status: "COMPLETED", sentences },
    });
    expect(nested).toMatchObject({ jobId: "voice_transcription_abc123", sourceId: "RE" + "a".repeat(32), accountId: "AC1", status: "completed", text: "Caller: Hello" });
    const flat = parseTwilioTranscriptPayload({ id: "voice_transcription_x9", status: "completed", sentences });
    expect(flat).toMatchObject({ jobId: "voice_transcription_x9", text: "Caller: Hello" });
    const opOnly = parseTwilioTranscriptPayload({ operationId: "voice_transcription_op1", status: "IN_PROGRESS" });
    expect(opOnly).toMatchObject({ jobId: "voice_transcription_op1", status: "in_progress", text: "" });
    expect(parseTwilioTranscriptPayload(null)).toMatchObject({ jobId: "", text: "" });
  });
});
