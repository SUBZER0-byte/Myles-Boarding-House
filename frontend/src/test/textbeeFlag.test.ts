import { isTextBeeEnabled } from "../../../supabase/functions/_shared/textbee.ts";

describe("TextBee enabled setting", () => {
  it.each(["true", "TRUE", "  true  ", "1"])("enables TextBee for %s", (value) => {
    expect(isTextBeeEnabled(value)).toBe(true);
  });

  it.each([undefined, "", "false", "0", "yes"])("keeps TextBee disabled for %s", (value) => {
    expect(isTextBeeEnabled(value)).toBe(false);
  });
});
