export function validateQuotes(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new Error('Expected a non-empty array of quotes');
  }

  for (const [index, quote] of quotes.entries()) {
    if (
      !quote ||
      typeof quote.text !== 'string' ||
      quote.text.trim().length === 0 ||
      typeof quote.author !== 'string' ||
      quote.author.trim().length === 0 ||
      !Array.isArray(quote.tags) ||
      !quote.tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0)
    ) {
      throw new Error(`Invalid quote at index ${index}`);
    }
  }
}
