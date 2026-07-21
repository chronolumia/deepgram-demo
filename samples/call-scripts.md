# Sample call scripts — for recording with friends

Five DataVoice customer-support call scripts, written for two people to read
aloud and record. Variable length (~1–5 min), English (matches the pipeline's
current fixed `language: "en"` setting — see `src/deepgram/client.ts`).

**All names, emails, phone numbers, and account IDs below are fake** — made
up for this script, not anyone's real data. Keep it that way when recording:
don't ad-lib in real personal details.

**Bold** words are deliberate: they're either DataVoice's own keyterm list
(`src/config/terms.json`) or "QuantaFlow" — a made-up, hard-to-guess feature
name planted specifically to demonstrate keyterm-prompting recall (S5.2:
Nova-3 has never seen this word before, so it's a genuine, honest before/after
test — try one run with the keyterm list and one without, on the same file,
and compare).

## Recording tips

- Phone voice memo or laptop mic is fine — Deepgram handles normal
  compressed audio (m4a, mp3, wav all work).
- Two people, natural pacing — pauses, "um"s, and talking slightly over each
  other are good, that's what real support calls sound like. Don't read it
  like a radio ad.
- Save as `.wav` or `.mp3`, one file per call.
- Suggested filenames: `call-004` through `call-008` (keeps the existing 3
  placeholder clips as call-001–003, or tell me to replace them entirely).
- Once you've recorded them, drop the files in `samples/` and tell me — I'll
  wire up `samples/meta.json` with the right `callId`/`agentId`/`startedAt`
  entries so `ingest.ts` picks them up automatically.

---

## Call 1 — Password reset / SSO login (~1 min)

**Scenario:** Quick, easy call. Customer locked out after DataVoice switched
to **SSO**. Fast resolution, upbeat tone.
**Speakers:** Agent = Priya · Customer = Jonas Bergmann
**Fake PII:** email `jonas.bergmann@northwind-example.com`

> **Priya (Agent):** Thanks for calling **DataVoice** support, this is Priya, how can I help you today?
>
> **Jonas (Customer):** Hi, yeah, I can't log into my dashboard anymore. It just keeps redirecting me in circles.
>
> **Priya:** Ah, that'll be the **SSO** rollout we did last week. Can I get the email on the account?
>
> **Jonas:** Sure, it's jonas dot bergmann at northwind dash example dot com.
>
> **Priya:** Got it. Okay, so your account was migrated to single sign-on, which means your old password won't work anymore — you need to log in through your company's identity provider now.
>
> **Jonas:** Oh. Nobody told me that.
>
> **Priya:** Yeah, sorry about that, the notification email apparently went to a lot of spam folders. I'm sending you a fresh SSO login link right now — should land in your inbox in about thirty seconds.
>
> **Jonas:** Okay... yep, got it. Let me try. ...Oh nice, that worked.
>
> **Priya:** Perfect. Anything else I can help with?
>
> **Jonas:** No, that's it, thanks.
>
> **Priya:** Anytime, have a good one.

---

## Call 2 — Billing question / API usage (~2.5 min)

**Scenario:** Customer confused about an overage charge tied to their **API
key** usage. Mildly annoyed at first, calms down once it's explained.
**Speakers:** Agent = Tom · Customer = Sarah Nguyen
**Fake PII:** account number `DV-88213`, phone `+1 (555) 019-2244`

> **Tom (Agent):** DataVoice support, this is Tom, who do I have the pleasure of speaking with?
>
> **Sarah (Customer):** Hi Tom, it's Sarah Nguyen, account number DV dash eight eight two one three. I've got a weird charge on my invoice this month and I have no idea what it's for.
>
> **Tom:** Okay, let me pull that up. Can I also grab a callback number just in case we get disconnected?
>
> **Sarah:** Yeah, it's plus one, five five five, zero one nine, twenty-two forty-four.
>
> **Tom:** Great, thank you. Okay, I'm looking at your account now... so I see an extra charge of about two hundred dollars, and that's coming from **API key** overage — looks like one of your integrations made a lot more calls than usual this month.
>
> **Sarah:** That doesn't make sense, we didn't change anything.
>
> **Tom:** Let me check which key it's tied to... Okay, so it's the key labeled "reporting-bot" — it made about forty thousand extra requests between the ninth and the fifteenth. Does that ring a bell? Sometimes it's a script that got stuck in a retry loop.
>
> **Sarah:** ...Actually, yeah, our intern was testing something that week. That's probably it.
>
> **Tom:** That would explain it exactly. Unfortunately I can't reverse usage-based charges after the fact, but what I can do is set up a usage alert on that key so you get notified before it happens again — want me to do that?
>
> **Sarah:** Yes please, that'd be great.
>
> **Tom:** Done — you'll get an email at eighty percent of your normal usage from now on. Anything else?
>
> **Sarah:** No, that clears it up, thank you for explaining.
>
> **Tom:** Of course, have a great rest of your day.

---

## Call 3 — Webhook integration broken (~3.5 min)

**Scenario:** IT admin troubleshooting a broken **webhook** between
**Genesys** and DataVoice's **QuantaFlow** routing feature. Technical,
gets a little tense mid-call, resolved together.
**Speakers:** Agent = Elena · Customer = Markus Keller (IT admin)
**Fake PII:** email `markus.keller@fjordtech-example.io`

> **Elena (Agent):** DataVoice technical support, Elena speaking.
>
> **Markus (Customer):** Hey Elena, this is Markus, I'm the IT admin over at Fjordtech. Our **webhook** from **Genesys** into DataVoice just stopped firing sometime last night and none of our new calls are showing up.
>
> **Elena:** Okay, let's dig in. Can I get your account email?
>
> **Markus:** markus dot keller at fjordtech dash example dot io.
>
> **Elena:** Thanks. Alright, I'm looking at your webhook logs now... I'm seeing a string of failed deliveries starting around 11 PM last night, all with a 401 error.
>
> **Markus:** 401? That's an auth error, right? We didn't touch the credentials.
>
> **Elena:** Right, it's unauthorized. Let me check if anything expired on our end... okay, actually — I see it. Your **API key** for the **QuantaFlow** connector expired at midnight. That's the routing layer that maps Genesys call events into your DataVoice pipeline.
>
> **Markus:** Nobody told us it was going to expire.
>
> **Elena:** You're right, and honestly, that's on us — the ninety-day expiration warnings should go out automatically two weeks ahead, and it looks like yours didn't send. I'm sorry about that.
>
> **Markus:** Okay, well, can we just fix it? We've got calls piling up.
>
> **Elena:** Yes — I'm generating a new key for the QuantaFlow connector right now. I'll send it to you in the next message, and you'll need to drop it into your Genesys webhook configuration where the old one was.
>
> **Markus:** Okay... give me a second, let me pull that screen up. ...Alright, where exactly does it go?
>
> **Elena:** Under Integrations, then Webhook Credentials — same field as before, just paste the new key over the old one and hit save. It should start flowing again within about a minute.
>
> **Markus:** Okay... saved it. ...Yeah, okay, I'm seeing calls come through again now.
>
> **Elena:** Great. I'm also going to flag your account so this doesn't happen silently again — and I'll check why the expiration warning didn't go out, that shouldn't happen.
>
> **Markus:** Appreciate that. This cost us a few hours of missing data though.
>
> **Elena:** Understood, and I'm sorry for that — I'm going to note this on your account, and someone from our team will follow up about the gap. Is there anything else I can help with right now?
>
> **Markus:** No, that's the main thing. Thanks for sorting it out quickly.
>
> **Elena:** Of course, and again, sorry for the trouble.

---

## Call 4 — Escalation: rocky migration from NICE (~5 min)

**Scenario:** Frustrated customer, DataVoice's migration off **NICE**
lost historical analytics data. Longest call, emotional arc from angry to
reassured. Ends with an escalation, not a full fix — realistic.
**Speakers:** Agent = David · Customer = Julia Fischer (Head of Support Ops)
**Fake PII:** account number `DV-40119`, email `julia.fischer@brightlane-example.com`

> **David (Agent):** Thank you for calling DataVoice, this is David, how can I help?
>
> **Julia (Customer):** Hi David. I need to speak to someone about our migration. This is honestly becoming a serious problem for us.
>
> **David:** I'm sorry to hear that, I'll do everything I can to help. Can I get your account number?
>
> **Julia:** DV dash four oh one one nine. We migrated off **NICE** about three weeks ago, and I was told — explicitly, in writing — that our historical call analytics would carry over. They didn't. We have six months of QA scoring data that's just gone.
>
> **David:** Okay, let me pull up your account and see what happened during the migration... I do see the migration job completed on the fourteenth. Let me check what was actually included in that job.
>
> **Julia:** I really hope you can find something, because right now it looks like we lost half a year of compliance records, and I have an audit coming up next month.
>
> **David:** I understand the urgency, and I want to be straight with you rather than guess — historical **NICE** analytics data was supposed to be part of the migration package, and if it wasn't transferred, that's a mistake on our side, not something you did wrong.
>
> **Julia:** Okay. So where is it?
>
> **David:** Looking at the migration log now... I can see the call recordings themselves did transfer, about eleven thousand of them, but the analytics layer — the QA scores, the tagging — that job shows as "skipped," not failed. That usually means it was never triggered in the first place.
>
> **Julia:** So it's sitting somewhere and just wasn't moved?
>
> **David:** That's what it looks like, yes, which is actually good news — it likely means the data still exists on the NICE side and can be re-pulled, rather than being permanently lost. But I want to be honest with you: I can't personally run that re-migration from this call, it needs our data engineering team.
>
> **Julia:** How long is that going to take? I have an **SLA** with a four-hour response time on data issues, and we're already past that.
>
> **David:** You're right, and I apologize for that — I'm going to escalate this to a Severity 1 ticket right now, which gets you a callback from data engineering within the hour, not the standard queue. I'm also going to personally follow up with you by end of day today regardless of where that stands.
>
> **Julia:** Okay. I appreciate you being straight with me about it, at least. This whole migration has been rockier than I expected.
>
> **David:** That's fair feedback, and I'll make sure it's logged against the account, not just this one ticket — you shouldn't have to fight for basics like this. Can I confirm the best callback number for the engineering team?
>
> **Julia:** Same one on file, ends in triple four one.
>
> **David:** Perfect, that's confirmed. You'll hear from someone within the hour, and from me by end of day either way.
>
> **Julia:** Okay. Thank you, David.
>
> **David:** Thank you for your patience, Julia, and again, I'm sorry this happened.

---

## Call 5 — Feature request & positive feedback (~2 min)

**Scenario:** Happy customer, lighter tone, ends on a positive note. Good
counterpoint to call 4 for topic/sentiment variety later.
**Speakers:** Agent = Priya · Customer = Amara Osei
**Fake PII:** none (kept intentionally simple)

> **Priya (Agent):** DataVoice support, this is Priya, how can I help?
>
> **Amara (Customer):** Hi! This isn't really a problem call, more of a — can I make a suggestion?
>
> **Priya:** Of course, I love those calls. What's on your mind?
>
> **Amara:** So we've been using **QuantaFlow** for a couple months now to route calls from **Five9**, and it's honestly been great — way fewer misrouted calls than before. But I was wondering if there's a way to get a weekly summary emailed to my team automatically, instead of us having to log in and check the dashboard.
>
> **Priya:** That's a really good idea, and actually — I don't think we have that yet, but I know it's come up before. Let me log it as a feature request under your account so the product team sees the actual demand for it.
>
> **Amara:** That'd be great. It's not urgent, just would save us some time.
>
> **Priya:** Totally understood. I'll flag it as "recurring digest / weekly summary email," and I'll mention it's tied to **QuantaFlow** usage specifically, since that's probably useful context for them.
>
> **Amara:** Perfect. And hey, unrelated, but your **Twilio** integration setup guide was way clearer than I expected — that whole switch took us like twenty minutes.
>
> **Priya:** Oh, I'll pass that along too, that's great to hear. Anything else I can help with today?
>
> **Amara:** Nope, that's everything. Thanks, Priya!
>
> **Priya:** Anytime, have a great day.
