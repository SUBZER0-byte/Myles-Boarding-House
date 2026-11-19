const filteredWords = new Set([
  "ass",
  "asses",
  "asshole",
  "assholes",
  "bastard",
  "bastards",
  "bitch",
  "bitches",
  "bitchy",
  "bullshit",
  "crap",
  "crappy",
  "damn",
  "damned",
  "damning",
  "dick",
  "dicks",
  "fuck",
  "fucked",
  "fucker",
  "fuckers",
  "fucking",
  "fucks",
  "hell",
  "jackass",
  "jackasses",
  "motherfucker",
  "motherfuckers",
  "motherfucking",
  "piss",
  "pissed",
  "pissing",
  "shit",
  "shits",
  "shitted",
  "shitting",
  "shitty",
  "slut",
  "sluts",
  "whore",
  "whores",
]);

const wordsPattern = /[\p{L}\p{N}]+/gu;

export function filterProfanity(text: string): string {
  return text.replace(wordsPattern, word => (
    filteredWords.has(word.toLowerCase()) ? "*".repeat(Array.from(word).length) : word
  ));
}
