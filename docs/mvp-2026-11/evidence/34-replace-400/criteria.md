# Selection criteria (selection only; written for the import of 29 October 2026, reused for the replacement of 3 November 2026)

These are working tests for picking claims that are likely to carry an issue tag. They were inferred from the Rulebook at edition 2026-10-29.1 on 29 October 2026. They are not rules. They never enter `rubric/`, the Rulebook's When to use or the judge prompt (hard rule 4). When the owners write real rules for these tags, this file is only a starting point.

The tags considered are the ones a reader can judge from the claim's text alone. Tags that need Geo or the web (Unsourced, Source inaccessible, Improperly sourced, Factually challenged, the duplicates) are left out.

## Context-dependent (judged; the rules in force, quoted verbatim from rubric.json at edition 2026-10-30.1; rubric.json governs)

1. A pronoun with no antecedent inside the claim ("He said ...", "its predecessor", "they announced") makes the claim Context-dependent.
2. A definite reference that needs an outside antecedent to identify it ("the vulnerabilities", "the discussions", "the recording", "the settlement terms", "the legal dispute", "recent actions", or a bare "the ruling" or "the state" that the claim does not specify) makes the claim Context-dependent, even when other entities in the claim are named; a bare reference to a particular event, decision or place is not a generic. The proper name of one specific institution, agency or court (a central bank, a commission) identifies itself and does not count. A bare 'the government' or 'the state' used generically for whoever governs, as in a general policy recommendation, is not an outside antecedent and does not count.
3. A descriptive definite that names a kind of thing but not which one ("the Bitcoin ETF", "the major-bank stablecoin consortium", "the open-access version", "the infrastructure", "the new model") makes the claim Context-dependent: the reader must already know which ETF, consortium, version or product is meant. A description that works as the name of one specific program, law or rule, so that only one thing fits it, already says which one and does not count; a description that more than one thing could fit (more than one campaign, more than one convention in the same city) still counts. Applies to countable things, not to abstract or mass nouns ("the regulatory clearance", "the market").
4. Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent.
5. Do not use for indefinites, time expressions, generics, or definites the claim itself resolves.

## Working tests for the tags with no rules yet

- **Trailing period:** a one-sentence claim whose text ends with "." (not "...", not an abbreviation such as "U.S.").
- **Multi-sentence:** the claim has two or more sentences, meaning a sentence-ending mark followed by a new sentence. A semicolon, a colon or a dash joining clauses does not count.
- **Improper capitalization:** capitals mid-sentence on words that are not proper nouns ("The Company Announced Record Profits"), proper nouns in lower case ("bitcoin" as a network name, "trump", "europe"), all-caps emphasis ("CAPPED"), or a claim that starts lower case. Acronyms (AI, ETF, NATO) are fine.
- **Incorrect grammar:** agreement errors, missing or doubled words, wrong word forms, broken punctuation (a missing comma that changes the parse, unbalanced quotes or brackets), or a sentence fragment that does not parse.
- **Poor wording:** grammatical, but hard to understand on a first read. Signs: stacked qualifiers, garbled order, an unclear scope of "not" or "only", jargon that hides the assertion, or two ideas fused so that it is not clear what is claimed.
- **Wordy:** a clearly shorter rewrite keeps the same meaning. Signs: filler ("it is the case that", "in terms of", "basically", "at the end of the day"), redundant qualifiers, nominalisations ("make a decision to"), or a claim over roughly 25 words where half would do.

### Contested points, not to be anchored on when real rules are written

These are the reviewer's notes of 29 October 2026.
- **Incorrect grammar, Poor wording and Wordy have no examples in the Rulebook**, so their tests above are invented.
  - The length test for Wordy ("over roughly 25 words") is a proxy that the description does not contain.
  - "Jargon that hides the assertion" depends on the audience.
  - Accepted usages are not errors: the distributive singular ("their brain"), less/fewer, mild non-parallelism.
  - Lower-case "bitcoin" for the network is a contested convention.
- **Overlaps:** when Wordy and Poor wording both fit, Poor wording wins if the meaning is unclear, and Wordy wins if only the length is the problem. Trailing period is its own tag, not Incorrect grammar.
- **Multi-sentence** is a Classification in the Rulebook (its counterpart is One sentence), not an Issue.
- **A generic "we"** ("We should slow down AI development") sits between rule 1 (a pronoun with no antecedent) and rule 5 (generics). The picks tag it Context-dependent as a boundary case for the owners to settle.

## Near-miss (the agent should learn to leave these alone)

A claim that looks like it might carry an issue tag but does not under the rules above:
- named institutions ("the European Central Bank", "the Supreme Court" as the one US court);
- a generic "the government" in a recommendation;
- time expressions ("last year", "this decade");
- indefinites ("a new model");
- mass or abstract nouns ("the market", "the economy");
- a definite the claim resolves itself ("the bill Congress passed in 2025 on stablecoins");
- an acronym in capitals;
- a long claim that cannot be shortened without losing meaning.

## Clean

None of the above: one clear, self-contained, well-formed sentence with no trailing period.
