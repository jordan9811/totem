---
pageClass: eli5
---

# Search

Search everything you have touched, including your private posts, without your searches or your private things leaving your device.

::: tip Status: works live, over what your device holds
Search over your own posts, private posts, messages, likes, bookmarks, stakes and imports works on the public preview, in your browser. The "AI" option is a built-in word list, not a real AI model. The cloud option is switched off, and even when allowed it uses a stand-in that sends nothing. Search does not look through Farcaster today: searching it through Neynar is built and switched off (below).
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Type a search on the Search page</li>
  <li class="flow__us"><strong>Your device</strong>Builds an index from your own sealed records, in memory</li>
  <li class="flow__us"><strong>Your device</strong>Finds matching words, and related words it knows are kin</li>
  <li><strong>You</strong>See results grouped by type, with private ones clearly marked</li>
</ol>
<p class="flow__note">The index is rebuilt from your records when you need it and is not stored anywhere in readable form.</p>

The index is built in the place that holds your opened records: on the public preview, your browser. It covers only your own personas' things. Private results show a dashed "Private · only you" frame. The public search box above it is unchanged. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}

## The obvious questions

### Does the server see what I search for?

No. Your searches over private things are answered on your device; the server has no search over your sealed records, and the tests check its database for search terms. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}

### Is the AI search real AI?

No. It is a list of related words built into the app, run on your device, that finds a paraphrase when it knows the words are kin. It tells you which meanings matched. A real on-device model can drop into the same place later. {cite: notes/reports/REPORT-MEGA2.md > "GATE 4 — Unified search (vault-local, keyword + AI)"}

### What is the cloud option?

Off by default. If you turn it on, each search first asks "send these N snippets to this provider?" and sends nothing until you agree. Today the provider is a stand-in, so nothing leaves even after you agree. {cite: notes/reports/REPORT-MEGA2.md > "GATE 4 — Unified search (vault-local, keyword + AI)"}

### Does compartment mode change search?

Yes. With compartment mode on, the index is built from one persona's records only. Your other personas' records are not read at all, rather than read and hidden. {cite: notes/reports/REPORT-POST.md > "GATE 2 — Persona tint + unified cross-persona view"}

### Can I search Farcaster?

Built on test data, not deployed, and off. Farcaster's own network has no search, so a Farcaster search goes through Neynar, by way of Totem's server, only when the site's operator switches search to Neynar (`FC_SOURCE_SEARCH=neynar`). Then the Search page shows your device's results first and "On Farcaster · Via Neynar" after them. What you type is sent; who you are is not, and a search that names one of your own accounts is never sent. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"}

## Where it lives in the code

`lib/search/` (the index, the word list, the embedding and its worker, and the unified search), `components/UnifiedSearch.tsx`, and `/search`.

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** Unified search: a vault-local index, keyword and a local model in a worker, cloud only behind named per-query consent, disclosure chrome; the index is re-derived after a restart. {cite: notes/reports/REPORT-MEGA2.md > "GATE 4 — Unified search (vault-local, keyword + AI)"}
