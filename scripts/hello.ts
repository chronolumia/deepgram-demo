import "dotenv/config";
import { transcribeUrl } from "../src/deepgram/client.js";

const TEST_AUDIO_URL = "https://dpgr.am/spacewalk.wav";

const response = await transcribeUrl(TEST_AUDIO_URL);

if (!("results" in response)) {
  throw new Error(`Expected a synchronous transcription result, got: ${JSON.stringify(response)}`);
}

const transcript = response.results.channels[0]?.alternatives?.[0]?.transcript;

console.log("Hello transcription:", transcript);
