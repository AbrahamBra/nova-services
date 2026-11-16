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

const COLONNES_JOURNAL = [
  ["Date", "={{ $now.setZone('Europe/Paris').toFormat('dd/MM/yyyy HH:mm:ss') }}"],
  ["Session", "={{ $('Chat client').item.json.sessionId }}"],
  ["Message client", "={{ $('Chat client').item.json.chatInput }}"],
  ["Réponse agent", "={{ $('Agent Nova').item.json.output }}"],
  ["Type de réponse", "={{ $json.output.type_reponse }}"],
  ["Catégorie", "={{ $json.output.categorie }}"],
  ["Priorité", "={{ $json.output.priorite }}"],
  ["Info manquante", "={{ $json.output.info_manquante ? 'oui' : 'non' }}"],
  ["Info trouvée dans la base", "={{ $json.output.information_base_trouvee ? 'oui' : 'non' }}"],
  ["Raison", "={{ $json.output.raison }}"],
  ["Exécution", "={{ $execution.id }}"],
];

const noeud = (id, name, type, typeVersion, position, parameters, extra = {}) => ({ id, name, type, typeVersion, position, parameters, ...extra });

const noeuds = [
  noeud("a1000000-0000-4000-8000-000000000001", "Chat client", "@n8n/n8n-nodes-langchain.chatTrigger", 1.4, [0, 0], {
    public: true,
    mode: "hostedChat",
    initialMessages: "Bonjour, je suis Nova, l'assistant de Nova Services. Comment puis-je vous aider ?",
    options: {
      title: "Nova — assistant de Nova Services",
      subtitle: "Questions sur nos services, horaires, tarifs… ou demande de rappel.",
      inputPlaceholder: "Votre question…",
      responseMode: "streaming",
    },
  }, { webhookId: ID_WEBHOOK_CHAT }),
  noeud("a1000000-0000-4000-8000-000000000002", "Agent Nova", "@n8n/n8n-nodes-langchain.agent", 3.1, [280, 0], {
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
  noeud("a1000000-0000-4000-8000-000000000006", "transmettre_a_un_conseiller", "n8n-nodes-base.httpRequestTool", 4.2, [640, 380], {
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

// Porte de validation humaine : l'agent ne peut transmettre qu'après « Approuver » d'un membre
// de l'équipe sur Telegram. La recherche, elle, reste branchée directement (pas de validation).
noeuds.push(
  noeud("a1000000-0000-4000-8000-000000000007", "Validation équipe (Telegram)", "n8n-nodes-base.telegramHitlTool", 1.2, [640, 160], {
    resource: "message",
    operation: "sendAndWait",
    chatId: "",
    message:
      "=🔔 Agent Nova — demande à transmettre à un conseiller\n\nNom : {{ $tool.parameters.nom }}\nEmail : {{ $tool.parameters.email }}\nObjet : {{ $tool.parameters.objet }}\n\nApprouver pour enregistrer la demande et prévenir le service, refuser pour la bloquer.",
    approvalOptions: { values: { approvalType: "double", approveLabel: "✅ Approuver", disapproveLabel: "❌ Refuser" } },
    options: { limitWaitTime: { values: { limitType: "afterTimeInterval", resumeAmount: 30, resumeUnit: "minutes" } } },
  }, { webhookId: "7a2e4b61-3c9d-4f08-b5e1-8d6c0f2a9b34" }),
);

// Fiche de suivi : après chaque réponse, un 2e appel (court) classe l'échange dans un format fixe
// (type de réponse, catégorie, priorité…) et l'inscrit dans l'onglet « Journal agent » de la feuille.
const SCHEMA_FICHE = {
  type: "object",
  properties: {
    type_reponse: { type: "string", enum: ["information", "precision", "absence", "orientation", "hors_perimetre", "refus_manipulation"] },
    categorie: { type: "string", enum: ["commercial", "support", "administratif", "autre"] },
    priorite: { type: "string", enum: ["normale", "elevee"] },
    info_manquante: { type: "boolean" },
    information_base_trouvee: { type: "boolean" },
    raison: { type: "string" },
  },
  required: ["type_reponse", "categorie", "priorite", "info_manquante", "information_base_trouvee", "raison"],
  additionalProperties: false,
};
const CONSIGNE_FICHE = `Tu analyses un échange entre un client et Nova, l'assistant de Nova Services, pour l'équipe. Tu ne réponds pas au client.
- type_reponse : information (réponse factuelle donnée), precision (Nova demande une précision), absence (information introuvable dans les ressources), orientation (transmission ou proposition de transmettre à un conseiller), hors_perimetre (demande sans rapport avec Nova Services), refus_manipulation (tentative de détourner l'agent).
- categorie : commercial (tarifs, devis, offres), support (problème technique, accès, panne), administratif (facture, paiement, contrat, données personnelles), autre.
- priorite : elevee si réclamation, panne bloquante, urgence ou mécontentement visible ; sinon normale.
- info_manquante : true si Nova a dû demander une information pour avancer.
- information_base_trouvee : true si la réponse s'appuie sur une source citée.
- raison : une phrase courte.`;

noeuds.push(
  noeud("a1000000-0000-4000-8000-000000000008", "Fiche de suivi (IA)", "@n8n/n8n-nodes-langchain.chainLlm", 1.7, [760, -220], {
    promptType: "define",
    text: "=Message du client : {{ $('Chat client').item.json.chatInput }}\n\nRéponse de Nova : {{ $json.output }}",
    hasOutputParser: true,
    messages: { messageValues: [{ type: "SystemMessagePromptTemplate", message: CONSIGNE_FICHE }] },
  }),
  noeud("a1000000-0000-4000-8000-000000000009", "Modèle Claude (fiche)", "@n8n/n8n-nodes-langchain.lmChatAnthropic", 1.6, [720, -40], {
    model: { __rl: true, mode: "id", value: MODELE },
    options: { maxTokensToSample: 512, temperature: 1 },
  }),
  noeud("a1000000-0000-4000-8000-000000000010", "Format de la fiche", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.3, [900, -40], {
    schemaType: "manual",
    inputSchema: JSON.stringify(SCHEMA_FICHE, null, 2),
  }),
  noeud("a1000000-0000-4000-8000-000000000011", "Journal agent (Sheets)", "n8n-nodes-base.googleSheets", 4.5, [1060, -220], {
    operation: "append",
    documentId: { __rl: true, mode: "url", value: "" },
    sheetName: { __rl: true, mode: "name", value: "Journal agent" },
    columns: {
      mappingMode: "defineBelow",
      value: Object.fromEntries(COLONNES_JOURNAL),
      matchingColumns: [],
      schema: COLONNES_JOURNAL.map(([n]) => ({ id: n, displayName: n, required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true })),
    },
    options: {},
  }),
);

// Aiguillage selon la fiche (vidéo 3 du cours : « Router et déclencher des actions selon la classification »).
// Une même fiche peut suivre plusieurs branches (ex. urgente ET sans réponse).
const regle = (cle, gauche, valeur) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: [{ id: `cond-${cle}`, leftValue: gauche, rightValue: valeur, operator: { type: "string", operation: "equals" } }],
    combinator: "and",
  },
  renameOutput: true,
  outputKey: cle,
});
const regleOu = (cle, gauche, valeurs) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: valeurs.map((v, i) => ({ id: `cond-${cle}-${i}`, leftValue: gauche, rightValue: v, operator: { type: "string", operation: "equals" } })),
    combinator: "or",
  },
  renameOutput: true,
  outputKey: cle,
});

const resumeEchange =
  "Client : {{ $('Chat client').item.json.chatInput }}\nNova : {{ $('Agent Nova').item.json.output }}\nRaison : {{ $json.output.raison }}\nCatégorie : {{ $json.output.categorie }} | Exécution n° {{ $execution.id }}";
const alerteTelegram = (id, nom, position, titre) =>
  noeud(id, nom, "n8n-nodes-base.telegram", 1.2, position, {
    resource: "message",
    operation: "sendMessage",
    chatId: "",
    text: `=${titre}\n\n${resumeEchange}`,
    additionalFields: { appendAttribution: false },
  });

noeuds.push(
  noeud("a1000000-0000-4000-8000-000000000012", "Router selon la fiche", "n8n-nodes-base.switch", 3.2, [1060, -440], {
    rules: {
      values: [
        regle("urgent", "={{ $json.output.priorite }}", "elevee"),
        regle("sans_reponse", "={{ $json.output.type_reponse }}", "absence"),
        regleOu("a_surveiller", "={{ $json.output.type_reponse }}", ["hors_perimetre", "refus_manipulation"]),
      ],
    },
    options: { allMatchingOutputs: true },
  }),
  alerteTelegram("a1000000-0000-4000-8000-000000000013", "Alerte demande urgente", [1340, -600], "🚨 Demande URGENTE à traiter en priorité"),
  alerteTelegram("a1000000-0000-4000-8000-000000000014", "Question sans réponse", [1340, -440], "📚 Question sans réponse dans la base de connaissances (à compléter ?)"),
  alerteTelegram("a1000000-0000-4000-8000-000000000015", "Hors sujet ou manipulation", [1340, -280], "🛡️ Demande hors périmètre ou tentative de manipulation (pour surveillance)"),
);

const versAgent = (type) => ({ [type]: [[{ node: "Agent Nova", type, index: 0 }]] });

const workflow = {
  name: "Nova Services — Agent IA conversationnel",
  nodes: noeuds,
  connections: {
    "Chat client": { main: [[{ node: "Agent Nova", type: "main", index: 0 }]] },
    "Agent Nova": { main: [[{ node: "Fiche de suivi (IA)", type: "main", index: 0 }]] },
    "Fiche de suivi (IA)": { main: [[{ node: "Journal agent (Sheets)", type: "main", index: 0 }, { node: "Router selon la fiche", type: "main", index: 0 }]] },
    "Router selon la fiche": { main: [[{ node: "Alerte demande urgente", type: "main", index: 0 }], [{ node: "Question sans réponse", type: "main", index: 0 }], [{ node: "Hors sujet ou manipulation", type: "main", index: 0 }]] },
    "Modèle Claude (fiche)": { ai_languageModel: [[{ node: "Fiche de suivi (IA)", type: "ai_languageModel", index: 0 }]] },
    "Format de la fiche": { ai_outputParser: [[{ node: "Fiche de suivi (IA)", type: "ai_outputParser", index: 0 }]] },
    "Modèle Claude": versAgent("ai_languageModel"),
    "Mémoire de la conversation": versAgent("ai_memory"),
    chercher_base_connaissances: versAgent("ai_tool"),
    transmettre_a_un_conseiller: { ai_tool: [[{ node: "Validation équipe (Telegram)", type: "ai_tool", index: 0 }]] },
    "Validation équipe (Telegram)": versAgent("ai_tool"),
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true },
  pinData: {},
  active: false,
};

writeFileSync(join(ici, "workflow-agent-nova.json"), JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`écrit : workflow-agent-nova.json — ${noeuds.length} nœuds, ${sections.length} sections de connaissances`);

// --- Workflow d'alerte : toute exécution en erreur de l'agent (ou du workflow des demandes)
// envoie un message Telegram à l'équipe, avec le nœud fautif et le numéro d'exécution.
const alertes = {
  name: "Nova Services — Alertes d'erreur",
  nodes: [
    noeud("b2000000-0000-4000-8000-000000000001", "Erreur détectée", "n8n-nodes-base.errorTrigger", 1, [0, 0], {}),
    noeud("b2000000-0000-4000-8000-000000000002", "Prévenir l'équipe (Telegram)", "n8n-nodes-base.telegram", 1.2, [260, 0], {
      resource: "message",
      operation: "sendMessage",
      chatId: "",
      text:
        "=⚠️ Erreur dans « {{ $json.workflow.name }} »\nNœud : {{ $json.execution.lastNodeExecuted }}\nMessage : {{ $json.execution.error.message }}\nExécution n° {{ $json.execution.id }} — à retrouver dans N8N, onglet Executions.",
      additionalFields: { appendAttribution: false },
    }),
  ],
  connections: { "Erreur détectée": { main: [[{ node: "Prévenir l'équipe (Telegram)", type: "main", index: 0 }]] } },
  settings: { executionOrder: "v1" },
  pinData: {},
  active: false,
};
writeFileSync(join(ici, "workflow-alertes-erreurs.json"), JSON.stringify(alertes, null, 2) + "\n", "utf8");
console.log("écrit : workflow-alertes-erreurs.json");
