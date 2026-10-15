# Blocked on the product owner

Raised at the next checkpoint, or at once when the product owner is in the chat. Work continues around each item.

| # | Blocker | Since | Raised at |
|---|---|---|---|
| B1 | `.env` holds a malformed `NOTION_TOKEN`: the loaded value is 54 characters and contains whitespace inside it, while the connection token tested on 2026-10-15 is 50 characters. Every live Notion call answers 401 "Authorization header must use the format Bearer <token>". Fix: the line must read exactly `NOTION_TOKEN=<the token>` with nothing else on it (no quotes, spaces, line break or comment). Until then: status, tag, the walkthrough's start and the calibration cannot run; code and tests continue. | 2026-10-15, after the token test | raised in the chat on 2026-10-15; fixed by the product owner the same day (token 50 characters, status runs) |
