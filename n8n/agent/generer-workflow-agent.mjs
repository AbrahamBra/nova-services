// Construit n8n/agent/workflow-agent-nova.json à partir des fichiers du dossier :
//   - instructions-systeme.md       → instructions système de l'agent
//   - base-connaissances/*.md       → base de connaissances (découpée par section « ## »)
// Usage : node n8n/agent/generer-workflow-agent.mjs
// Après une modification de la base ou des instructions : relancer, puis réimporter.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));

// Identifiants fixes : l'adresse du chat reste la même d'une version à l'autre.
const ID_WEBHOOK_CHAT = "6f1d3c52-8a47-4e0b-9c1a-2b7e5d9f0a11";
const MODELE = "claude-haiku-5-5";

// --- Base de connaissances : une entrée par section « ## » ---
const sections = [];
for (const fichier of readdirSync(join(ici, "base-connaissances")).filter((f) => f.endsWith(".md")).sort()) {
  const texte = readFileSync(join(ici, "base-connaissances", fichier), "utf8");
  const source = (texte.match(/^# (.+)$/m) ?? [, fichier])[1].trim();
  for (const bloc of texte.split(/^## /m).slice(1)) {
    const [titre, ...corps] = bloc.split("\n");
    sections.push({ source, titre: titre.trim(), texte: corps.join(" ").replace(/\s+/g, " ").trim() });
  }
}

// --- Outil de recherche (RAG simple, par mots-clés) ---
// Pas de base vectorielle : les ressources tiennent en une trentaine de sections,
// une recherche par mots (avec synonymes) suffit, ne coûte rien et reste vérifiable.
const codeRecherche = `// Recherche dans la base de connaissances de Nova Services.
// Entrée : « query » (la question ou des mots-clés). Sortie : les 4 extraits les plus proches.
const BASE = ${JSON.stringify(sections, null, 0)};

const MOTS_VIDES = new Set('a au aux avec ce ces cet cette comment dans de des du elle en est et etre il ils je la le les leur lui ma mais me mes moi mon ne nous on ou par pas pour qu que quel quelle quels quelles qui sa se ses si son sur ta te tes toi ton tu un une vos votre vous y avez ai suis faire fait peut puis peux veux voudrais bonjour merci svp'.split(' '));
const SYNONYMES = {
  prix: 'tarif', cout: 'tarif', coute: 'tarif', combien: 'tarif', cher: 'tarif', payer: 'paiement', paye: 'paiement',
  reglement: 'paiement', regler: 'paiement', carte: 'paiement', cheque: 'paiement', horaire: 'horaires', heure: 'horaires',
  ouvert: 'ouverture', ouvre: 'ouverture', ferme: 'fermeture', joindre: 'contact', contacter: 'contact', telephone: 'rappel',
  appeler: 'rappel', rappeler: 'rappel', rappelle: 'rappel', conseiller: 'rappel', humain: 'rappel', panne: 'panne',
  bug: 'panne', marche: 'panne', fonctionne: 'panne', plante: 'panne', mdp: 'passe', identifiant: 'passe',
  resilier: 'resilier', resiliation: 'resilier', arreter: 'resilier', abonnement: 'maintenance', mensuel: 'maintenance',
  web: 'site', internet: 'site', boutique: 'vente', ecommerce: 'vente', remise: 'remises', reduction: 'remises',
  promo: 'remises', rgpd: 'personnelles', effacer: 'effacees', supprimer: 'effacees', facturation: 'facture',
};
const normaliser = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const racine = (m) => (m.length > 5 ? m.slice(0, 5) : m.replace(/s$/, ''));
const termes = (t) => normaliser(t).split(/\\s+/).filter((m) => m.length > 2 && !MOTS_VIDES.has(m));

const motsQuestion = new Set();
for (const m of termes(query)) motsQuestion.add(racine(SYNONYMES[m] ?? m));
if (motsQuestion.size === 0) return 'AUCUN_RESULTAT : la recherche est vide. Demande une précision à la personne.';

// Un mot présent partout (« site ») compte peu ; un mot rare (« maintenance », « tarif ») compte beaucoup.
const index = BASE.map((s) => ({ s, titre: new Set(termes(s.titre + ' ' + s.source).map(racine)), corps: new Set(termes(s.texte).map(racine)) }));
const poids = (m) => {
  const n = index.filter((x) => x.titre.has(m) || x.corps.has(m)).length;
  return n === 0 ? 0 : Math.log(1 + BASE.length / n);
};
const resultats = index.map(({ s, titre, corps }) => {
  let score = 0;
  for (const m of motsQuestion) { if (titre.has(m)) score += 2 * poids(m); else if (corps.has(m)) score += poids(m); }
  return { ...s, score };
}).filter((s) => s.score >= 2.5).sort((a, b) => b.score - a.score).slice(0, 4);

if (resultats.length === 0) {
  return 'AUCUN_RESULTAT : rien sur ce sujet dans les ressources de Nova Services. Ne réponds pas de mémoire : dis que tu n\\'as pas l\\'information et propose de transmettre à un conseiller.';
}
return resultats.map((s, i) => \`[\${i + 1}] Source : \${s.source} — \${s.titre}\\n\${s.texte}\`).join('\\n\\n');`;

const instructions = readFileSync(join(ici, "instructions-systeme.md"), "utf8").trim();

const corpsTransmission = `={{ JSON.stringify({
  nom: $fromAI('nom', 'Nom complet de la personne, tel qu\\'elle l\\'a donné', 'string'),
  email: $fromAI('email', 'Adresse email de la personne, telle qu\\'elle l\\'a donnée', 'string'),
  message: '[Agent IA Nova] ' + $fromAI('objet', 'Objet de la demande en une ou deux phrases, avec le numéro de téléphone si la personne l\\'a donné', 'string')
}) }}`;

const noeud = (id, name, type, typeVersion, position, parameters, extra = {}) => ({ id, name, type, typeVersion, position, parameters, ...extra });

const noeuds = [
  noeud("a1000000-0000-4000-8000-000000000001", "Chat client", "@n8n/n8n-nodes-langchain.chatTrigger", 1.1, [0, 0], {
    public: true,
    mode: "hostedChat",
    initialMessages: "Bonjour, je suis Nova, l'assistant de Nova Services. Comment puis-je vous aider ?",
    options: {
      title: "Nova — assistant de Nova Services",
      subtitle: "Questions sur nos services, horaires, tarifs… ou demande de rappel.",
      inputPlaceholder: "Votre question…",
    },
  }, { webhookId: ID_WEBHOOK_CHAT }),
  noeud("a1000000-0000-4000-8000-000000000002", "Agent Nova", "@n8n/n8n-nodes-langchain.agent", 2.2, [280, 0], {
    options: { systemMessage: instructions, maxIterations: 6 },
  }),
  noeud("a1000000-0000-4000-8000-000000000003", "Modèle Claude", "@n8n/n8n-nodes-langchain.lmChatAnthropic", 1.6, [100, 240], {
    model: { __rl: true, mode: "id", value: MODELE },
    options: { maxTokensToSample: 1024, temperature: 1 },
  }),
  noeud("a1000000-0000-4000-8000-000000000004", "Mémoire de la conversation", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [260, 240], {
    contextWindowLength: 10,
  }),
  noeud("a1000000-0000-4000-8000-000000000005", "chercher_base_connaissances", "@n8n/n8n-nodes-langchain.toolCode", 1.3, [420, 240], {
    description:
      "Cherche dans les ressources officielles de Nova Services (services, horaires, contact, tarifs, FAQ, procédures, informations clients). Entrée : la question de la personne ou quelques mots-clés en français. Renvoie au plus 4 extraits avec leur source, ou AUCUN_RESULTAT.",
    language: "javaScript",
    jsCode: codeRecherche,
  }),
  noeud("a1000000-0000-4000-8000-000000000006", "transmettre_a_un_conseiller", "n8n-nodes-base.httpRequestTool", 4.2, [580, 240], {
    toolDescription:
      "Transmet une demande à l'équipe de Nova Services, qui recontacte la personne (rappel, devis, panne, résiliation, réclamation, question sans réponse). À utiliser UNIQUEMENT après avoir obtenu le nom, l'email et l'objet, et après un « oui » explicite de la personne au récapitulatif. Renvoie ok:true si la demande est enregistrée, sinon ok:false avec l'erreur.",
    method: "POST",
    url: "http://localhost:5678/webhook/nova-demande",
    sendBody: true,
    specifyBody: "json",
    jsonBody: corpsTransmission,
    options: { response: { response: { neverError: true } }, timeout: 60000 },
  }),
];

const versAgent = (type) => ({ [type]: [[{ node: "Agent Nova", type, index: 0 }]] });

const workflow = {
  name: "Nova Services — Agent IA conversationnel",
  nodes: noeuds,
  connections: {
    "Chat client": { main: [[{ node: "Agent Nova", type: "main", index: 0 }]] },
    "Modèle Claude": versAgent("ai_languageModel"),
    "Mémoire de la conversation": versAgent("ai_memory"),
    chercher_base_connaissances: versAgent("ai_tool"),
    transmettre_a_un_conseiller: versAgent("ai_tool"),
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true },
  pinData: {},
  active: false,
};

writeFileSync(join(ici, "workflow-agent-nova.json"), JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`écrit : workflow-agent-nova.json — ${noeuds.length} nœuds, ${sections.length} sections de connaissances`);
