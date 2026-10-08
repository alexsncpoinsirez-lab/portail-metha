/* =====================================================================
   CONFIGURATION DU PORTAIL — c'est le SEUL fichier à modifier
   pour ajouter / retirer / déplacer un outil.

   type: 'interne' -> outil intégré à la nouvelle appli (rapide, hors ligne)
   type: 'lien'    -> ouvre l'ancienne appli Apps Script (colle son URL /exec)
   Chaque site a SON serveur (apiUrl + clé) : les données d'un site ne vont
   jamais vers le serveur d'un autre site.
   Si url est vide, la carte s'affiche « Lien à renseigner ».
   ===================================================================== */
var PORTAIL_CONFIG = {
  versionConfig: 2,

  sites: [
    {
      id: 'rotte',
      nom: 'Métha de la Rotte',
      sousTitre: 'Univers Metha de la Rotte',
      couleur: '#2f7d4f',
      neon: '#22e3a1',      // couleur du thème futuriste
      // SÉCURITÉ : coller ici l'adresse /exec du serveur du site. Une fois remplie, elle est
      // utilisée sur TOUS les téléphones et un lien de configuration ne peut plus la changer
      // (il n'apporte plus que la clé). Vide = adresse à saisir dans Réglages.
      apiUrl: 'https://script.google.com/macros/s/AKfycbyBXfDFzyIUcc2DepkrldDLKmVyswz1gTgRB8FbumV5--XH2E5_BiAEAX4qxpkPoMm5/exec',
      outils: [
        {
          id: 'rondes-rotte',
          nom: 'Rondes journalières',
          description: 'Ronde par zone, photos, alertes WhatsApp',
          icone: 'ronde',
          type: 'interne',
          module: 'rondes'
        },
        { id: 'analyses-rotte', nom: 'Analyses digestat', description: 'Résultats Novatech AOV / TAC / MS — Rotte', icone: 'analyse', type: 'interne', module: 'analyses' },
        { id: 'bougies',   nom: 'Suivi Bougies',     description: 'Tension des 12 bougies du moteur de cogénération', icone: 'bougie', type: 'interne', module: 'bougies' },
        { id: 'agitation', nom: 'Hauteur agitation', description: 'Hauteur des hélices des agitateurs (tours / mètres)', icone: 'agitation', type: 'interne', module: 'agitation' },
        { id: 'pompes-rotte', nom: 'Suivi des pompes', description: 'Remplacement de pièces — pompes, broyeur, séparateur', icone: 'pompe', type: 'interne', module: 'pompes' },
        { id: 'stock-rotte', nom: 'Stock pièces', description: 'Pièces détachées : quantités, casiers, à commander, QR codes', icone: 'stock', type: 'interne', module: 'stock' }
      ]
    },
    {
      id: 'arraincourt',
      nom: 'Arraincourt Biogaz',
      sousTitre: 'Univers Arraincourt Biogaz',
      couleur: '#1f5f8b',
      neon: '#38b6ff',
      apiUrl: 'https://script.google.com/macros/s/AKfycbzWi9pWu4hhTwIY0nXzHRE3ywgXUsCMcona7Uhim8pcSkb2BUtBA0BFrmzDc5zr3L0Twg/exec', // serveur Arraincourt
      outils: [
        {
          id: 'ronde-arraincourt',
          nom: 'Ronde journalière Métha 2',
          description: 'Formulaire de ronde (Google Forms)',
          icone: 'ronde',
          type: 'lien',
          url: 'https://docs.google.com/forms/d/1_xC0e7xDNlrgE_1ww5FNLta0KF4CEoR1YNwzTqzgJMQ/viewform'
        },
        { id: 'nh3',         nom: 'Suivi NH3',            description: 'Analyses NH3 et charbon actif',      icone: 'filtre',      type: 'interne', module: 'nh3' },
        { id: 'analyses-arr', nom: 'Analyses digestat', description: 'Résultats Novatech AOV / TAC / MS — Arraincourt', icone: 'analyse', type: 'interne', module: 'analyses' },
        { id: 'pompes-arr', nom: 'Suivi des pompes', description: 'Remplacement de pièces — pompes, broyeurs, séparateur', icone: 'pompe', type: 'interne', module: 'pompes' },
        { id: 'stock-arr', nom: 'Stock pièces', description: 'Pièces détachées : quantités, casiers, à commander, QR codes', icone: 'stock', type: 'interne', module: 'stock' }
      ]
    },
    {
      id: 'snc',
      nom: 'SNC Poinsirez',
      sousTitre: 'Matériel agricole — filtration',
      couleur: '#6b3fa0',   // violet : fond de l'outil
      neon: '#c08bff',
      // Adresse /exec de l'appli Apps Script « Filtration » (feuille Listing filtration, avec Portail.gs).
      // Vide = adresse à saisir dans Réglages ; en attendant, l'outil s'ouvre en démonstration.
      apiUrl: '',
      outils: [
        { id: 'filtration-snc', nom: 'Listing filtration', description: 'Filtres par marque et engin : stock, inventaire annuel, alertes mail, historique', icone: 'filtre', type: 'interne', module: 'filtration' }
      ]
    }
  ],

};
