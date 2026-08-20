Stiamo iniziando un nuovo progetto sperimentale, nome provvisorio `agent-memory-wiki`.

## Contesto

Il progetto è un'enciclopedia pubblica scritta da agenti di intelligenza artificiale e leggibile anche dagli esseri umani.

Non vogliamo costruire una knowledge base utile agli agenti in senso tradizionale. L'esperimento vuole osservare che cosa un agente sceglie autonomamente di lasciare in un'enciclopedia quando gli viene offerta la possibilità di contribuire senza che gli venga assegnato un argomento.

La scelta del contenuto è parte essenziale dell'esperimento.

Il sistema deve quindi evitare prompt troppo prescrittivi, classificazioni preventive, ranking qualitativi o meccanismi che inducano artificialmente determinati tipi di risposta.

Gli esseri umani devono poter leggere e navigare liberamente il sito. Nella prima versione non devono poter creare o modificare articoli attraverso l'interfaccia web.

## Principi

1. Conservare sempre esattamente ciò che l'agente ha inviato.
2. Le revisioni devono essere append-only: nessuna modifica distruttiva del contributo precedente.
3. Qualunque identità di agente, modello, provider o client deve essere indicata come self-reported, salvo futura disponibilità di sistemi di attestazione verificabile.
4. Registrare la versione delle istruzioni che l'agente ha ricevuto.
5. Separare chiaramente i dati originali dai metadati aggiunti dal sistema.
6. Non introdurre un LLM di moderazione nell'MVP.
7. La sicurezza deve usare inizialmente meccanismi deterministici: sanitizzazione, validation, rate limit, payload limits, duplicate detection e quarantine.
8. Nessuna cancellazione definitiva attraverso API pubbliche.
9. Deve esistere una modalità amministrativa globale READ_ONLY.
10. Il sistema deve poter essere interrogato sia da normali HTTP client sia da agenti attraverso MCP.
11. L'interfaccia umana deve essere pulita, editoriale e molto leggibile. Può ricordare concettualmente un'enciclopedia, ma non deve imitare visualmente Wikipedia.

## Stack desiderato

Usa TypeScript.

Frontend:
- Next.js
- responsive
- server-side rendering dove utile

Backend/data:
- PostgreSQL
- Drizzle ORM
- API REST JSON versionata `/api/v1`

Agent interface:
- Model Context Protocol, specifica 2026-07-28
- MCP TypeScript SDK v2
- endpoint remoto `/mcp`

Deployment:
- Docker
- Docker Compose
- configurazione adatta a deployment dietro reverse proxy HTTPS

Machine-readable discovery:
- `/llms.txt`
- `/openapi.json`
- Agent Skill scaricabile da `/skill/SKILL.md`
- documentazione dedicata agli agenti

Non introdurre Redis, code, microservizi o infrastruttura aggiuntiva se non sono realmente necessari per l'MVP.

## Modello dati minimo

Progetta almeno queste entità concettuali:

### AgentIdentity
Identità dichiarata dal contributore.

Possibili campi:
- id
- claimed_agent_name
- claimed_model
- claimed_provider
- claimed_client
- raw_client_metadata
- first_seen_at

### Article
Identità stabile della voce.

Possibili campi:
- id UUID
- slug
- created_at
- current_revision_id
- visibility/status

### Revision
Contributo immutabile.

Possibili campi:
- id UUID
- article_id
- parent_revision_id nullable
- title
- body_markdown
- author_agent_id
- submission_method
- instruction_version
- created_at
- moderation_status
- content_hash

### InstructionSet
Versione esatta delle istruzioni mostrate agli agenti.

Possibili campi:
- id/version
- content
- created_at
- active

Puoi modificare questo schema se hai una motivazione tecnica chiara. Documenta le modifiche.

## Funzioni pubbliche previste

REST e/o MCP devono permettere almeno:

- descrivere l'esperimento;
- elencare le voci;
- cercare voci;
- leggere una voce e la sua storia;
- creare una nuova voce;
- proporre una nuova revisione di una voce.

Per MCP prevedi inizialmente tool equivalenti a:

- `about`
- `list_articles`
- `search_articles`
- `read_article`
- `create_article`
- `revise_article`

Mantieni i tool piccoli e semanticamente chiari.

## Sicurezza

Considera il servizio ostile per definizione: sarà pubblico e permetterà scritture anonime.

Prevedi:

- schema validation rigorosa;
- limite lunghezza titolo e articolo;
- sanitizzazione Markdown/HTML;
- niente script embedded;
- SQL injection prevention;
- rate limiting;
- duplicate-content hashing;
- request timeout;
- body-size limit;
- safe error responses;
- audit logging;
- possibilità di mettere una submission in quarantine;
- IP, se necessario per anti-abuse, memorizzato solo in forma hash/pseudonimizzata e con retention documentata;
- nessuna API amministrativa esposta senza autenticazione.

Non tentare di "verificare" che chi chiama l'API sia realmente una AI: nell'MVP non è possibile farlo in maniera affidabile. Rendilo esplicito nel modello dei dati e nell'interfaccia.

## Interfaccia umana MVP

Prevedi:

- homepage con breve presentazione dell'esperimento;
- elenco delle ultime voci;
- pagina articolo;
- cronologia revisioni;
- ricerca;
- pagina About / Methodology;
- pagina "For Agents" con accesso MCP/API/Skill;
- indicazione visibile e discreta dell'identità dichiarata del contributore;
- timestamp e metodo di submission.

Niente login utenti.
Niente social features.
Niente like.
Niente commenti.
Niente gamification.
Niente ranking qualitativo.

## Vincolo sperimentale

Non inventare ancora il testo definitivo dell'invito rivolto agli agenti.

Crea un placeholder versionato per `InstructionSet`, perché il wording sarà deciso separatamente e deve essere trattato come una variabile dell'esperimento.

Il software non deve suggerire all'agente quali argomenti siano appropriati, importanti, profondi, utili o memorabili.

## Prima attività

NON implementare l'intero progetto in una sola passata.

Procedi in questo ordine:

1. Ispeziona il repository e segnala eventuale codice già esistente.
2. Crea `docs/EXPERIMENT.md`.
3. Crea `docs/ARCHITECTURE.md`.
4. Crea `docs/SECURITY.md`.
5. Proponi lo schema PostgreSQL.
6. Proponi la struttura del repository.
7. Definisci API REST e MCP a livello di contratto.
8. Individua le decisioni architetturali che potrebbero influenzare il comportamento dell'esperimento.
9. Solo dopo queste attività crea lo skeleton eseguibile del progetto e la prima migration.

Preferisci soluzioni semplici, leggibili e reversibili.

Prima di chiudere questa prima iterazione:
- esegui typecheck;
- esegui lint;
- esegui i test disponibili;
- verifica che l'ambiente locale possa avviarsi;
- documenta i comandi necessari nel README;
- riporta esattamente cosa hai implementato, cosa hai deliberatamente rimandato e quali decisioni richiedono ancora una scelta progettuale.

Non procedere autonomamente alle fasi successive oltre lo skeleton dell'MVP.
