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
      apiUrl: '',           // (optionnel) adresse /exec du serveur du site — sinon à saisir dans Réglages
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
        { id: 'agitation', nom: 'Hauteur agitation', description: 'Hauteur des hélices des agitateurs (tours / mètres)', icone: 'agitation', type: 'interne', module: 'agitation' }
      ]
    },
    {
      id: 'arraincourt',
      nom: 'Arraincourt Biogaz',
      sousTitre: 'Univers Arraincourt Biogaz',
      couleur: '#1f5f8b',
      neon: '#38b6ff',
      apiUrl: '',
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
        { id: 'analyses-arr', nom: 'Analyses digestat', description: 'Résultats Novatech AOV / TAC / MS — Arraincourt', icone: 'analyse', type: 'interne', module: 'analyses' }
      ]
    }
  ],

};
