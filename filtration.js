/* =====================================================================
   MODULE « LISTING FILTRATION » — SNC Poinsirez
   Feuille Google « Listing filtration » :
   - marques -> engins -> filtres (référence d'origine, adaptable) ;
   - sortie / entrée de stock en deux touches (hors ligne possible) ;
   - inventaire annuel rapide (comptage gardé sur le téléphone) ;
   - historique : les sorties de l'année d'un coup d'œil ;
   - liste « à commander » partageable (WhatsApp, mail…).
   Le stock est tenu PAR RÉFÉRENCE : un filtre monté sur plusieurs engins
   n'a qu'un seul stock. Le serveur envoie un mail quand une référence
   passe sous son seuil mini.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var SANS_MARQUE = 'À classer';
  var MOTIFS_SORTIE = ['Entretien', 'Panne', 'Autre'];
  var MOTIFS_ENTREE = ['Réception commande', 'Retour', 'Correction'];
  // Couleur de repère par marque (pastille + liseré) — les autres marques prennent une teinte violette
  var TEINTES = { 'new holland': '#2f6fd6', 'case ih': '#d23a3a', 'john deere': '#3c9a3c', 'fendt': '#6aa84f', 'manitou': '#e0452f',
    'jcb': '#f2b300', 'artec': '#ef7d22', 'volvo': '#2b4f8c', 'merlo': '#2e9c6a', 'claas': '#9cbf2a' };

  /* ---------- outils ---------- */
  function texte(x) { return String(x === null || x === undefined ? '' : x).replace(/\s+/g, ' ').trim(); }
  function norm(t) { return texte(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // même règle que le serveur : majuscules, sans espaces / points / tirets ; au moins un chiffre
  function cleRef(x) {
    var t = texte(x).toUpperCase().replace(/^P\/N\s*/, '').replace(/[\s.\-]/g, '');
    if (t.length < 3 || !/\d/.test(t) || /^X\d*$/.test(t)) return '';
    return t;
  }
  function sousSeuil(stock, seuil) { return seuil > 0 && stock !== null && stock !== undefined && stock <= seuil; }
  function cleLigne(l) { return cleRef(l.o) || (texte(l.o) ? '' : cleRef(l.a)); }
  function teinte(m) {
    var k = norm(m);
    if (TEINTES[k]) return TEINTES[k];
    var h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360;
    return 'hsl(' + (250 + h % 70) + ' 55% 55%)';
  }
  function initiales(m) {
    var p = texte(m).split(' ').filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : texte(m).slice(0, 3)).toUpperCase();
  }
  function entier(v, min) {
    var n = PM.nombre(v);
    if (n === null || isNaN(n)) return NaN;
    n = Math.round(n);
    return n < (min || 0) ? NaN : n;
  }
  function dateCourte(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function modale(titre, sousTitre, contenu) {
    var fermerBtn = el('button', { type: 'button', class: 'ag-fermer', 'aria-label': 'Fermer' }, ['×']);
    var fond = el('div', { class: 'ag-modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre });
    function fermer() { fond.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', fermer); }
    function esc(ev) { var t = document.querySelectorAll('.ag-modale'); if (ev.key === 'Escape' && fond === t[t.length - 1]) fermer(); }
    fermerBtn.addEventListener('click', fermer);
    fond.addEventListener('click', function (ev) { if (ev.target === fond) fermer(); });
    document.addEventListener('keydown', esc);
    window.addEventListener('hashchange', fermer);
    fond.appendChild(el('div', { class: 'ag-modale-boite' }, [
      el('div', { class: 'ag-modale-tete' }, [el('div', {}, [el('h2', {}, [titre]), sousTitre ? el('div', { class: 'petit' }, [sousTitre]) : null]), fermerBtn])
    ].concat(contenu)));
    document.body.appendChild(fond);
    return fermer;
  }
  function tableau(entetes, lignes, classe) {
    var tbody = el('tbody');
    lignes.forEach(function (tr) { tbody.appendChild(tr); });
    return el('div', { class: 'bandeau st-tableau' }, [el('table', { class: 'nh3-table st-table' + (classe ? ' ' + classe : '') }, [
      el('thead', {}, [el('tr', {}, entetes.map(function (h) { return el('th', {}, [h]); }))]), tbody])]);
  }
  function champ(label, input, aide) {
    return el('div', { class: 'champ' }, [el('label', {}, [label]), input, aide ? el('div', { class: 'petit' }, [aide]) : null]);
  }

  /* ---------- données : listing du serveur + saisies pas encore confirmées ---------- */
  function cles(siteId) { return { tout: 'fi_tout_' + siteId, attente: 'fi_attente_' + siteId, histo: 'fi_histo_' + siteId + '_' }; }
  function calculer(T, attente) {
    var marques = (T.marques || []).slice();
    var engins = (T.engins || []).map(function (e) { return { nom: e.nom, marque: e.marque || SANS_MARQUE, site: e.site || '' }; });
    var lignes = (T.filtres || []).map(function (l) { return Object.assign({}, l); });
    function engin(nom) { return engins.filter(function (e) { return norm(e.nom) === norm(nom); })[0]; }
    function trouverLigne(a) {
      return lignes.filter(function (l) { return l.l === a.ligne && norm(l.e) === norm(a.engin) && l.o === texte(a.avantOrigine); })[0]
        || lignes.filter(function (l) { return norm(l.e) === norm(a.engin) && l.o === texte(a.avantOrigine) && norm(l.t) === norm(a.avantType); })[0];
    }
    (attente || []).forEach(function (a) {
      if (a.type === 'filtration.marque') { if (marques.map(norm).indexOf(norm(a.nom)) < 0) marques.push(a.nom); }
      else if (a.type === 'filtration.engin') {
        var e = engin(a.nom);
        if (a.marque && a.marque !== SANS_MARQUE && marques.map(norm).indexOf(norm(a.marque)) < 0) marques.push(a.marque);
        if (e) { e.marque = a.marque || SANS_MARQUE; if (a.site !== undefined) e.site = a.site; }
        else engins.push({ nom: a.nom, marque: a.marque || SANS_MARQUE, site: a.site || '', enAttente: true });
      } else if (a.type === 'filtration.filtre') {
        lignes.push({ l: 0, s: a.site || '', e: a.engin, t: a.type2, o: texte(a.origine), a: texte(a.adaptable), q: a.qte, m: a.seuil, st: a.stock === undefined ? null : a.stock, enAttente: true, id: a.id });
      } else if (a.type === 'filtration.modifFiltre') {
        var l = trouverLigne(a);
        if (l) { l.t = a.type2; l.o = texte(a.origine); l.a = texte(a.adaptable); l.q = a.qte; l.m = a.seuil; l.enAttente = true; }
      } else if (a.type === 'filtration.supprimerFiltre') {
        var s = trouverLigne(a);
        if (s) lignes.splice(lignes.indexOf(s), 1);
      }
    });
    // références (stock commun à toutes les lignes d'une même référence)
    var refs = {};
    lignes.forEach(function (l) {
      l.k = cleLigne(l);
      if (!l.k) return;
      var r = refs[l.k] = refs[l.k] || { k: l.k, ref: l.o || l.a, lignes: [], stock: null, seuil: 0, types: [], engins: [] };
      r.lignes.push(l);
      if (r.stock === null && l.st !== null && l.st !== undefined && l.st !== '') r.stock = Number(l.st);
      if (Number(l.m) > r.seuil) r.seuil = Number(l.m);
      if (l.t && r.types.map(norm).indexOf(norm(l.t)) < 0) r.types.push(l.t);
      if (r.engins.indexOf(l.e) < 0) r.engins.push(l.e);
    });
    (attente || []).forEach(function (a) {
      var r = refs[cleRef(a.reference)];
      if (!r) return;
      if (a.type === 'filtration.inventaire') { r.stock = a.compte; r.enAttente = true; }
      else if (a.type === 'filtration.mouvement') { r.stock = Math.max(0, (r.stock || 0) + (a.sens === 'entree' ? a.quantite : -a.quantite)); r.enAttente = true; }
    });
    // « sous le seuil » = même règle que l'appli Filtration et le serveur : stock <= seuil mini (seuil > 0)
    Object.keys(refs).forEach(function (k) { var r = refs[k]; r.bas = sousSeuil(r.stock, r.seuil); r.aCommander = r.bas ? Math.max(r.seuil - r.stock, 0) : 0; });
    // engins présents dans le listing mais pas encore dans la liste (sécurité)
    lignes.forEach(function (l) { if (!engin(l.e)) engins.push({ nom: l.e, marque: SANS_MARQUE, site: l.s || '' }); });
    engins.forEach(function (e) {
      e.lignes = lignes.filter(function (l) { return norm(l.e) === norm(e.nom); });
      var ks = {}; e.lignes.forEach(function (l) { if (l.k) ks[l.k] = true; });
      e.nbAlertes = Object.keys(ks).filter(function (k) { return refs[k].bas; }).length;
    });
    if (engins.some(function (e) { return e.marque === SANS_MARQUE; }) && marques.indexOf(SANS_MARQUE) < 0) marques.push(SANS_MARQUE);
    return { marques: marques, engins: engins, lignes: lignes, refs: refs };
  }

  /* ---------- démonstration (serveur pas encore installé) ---------- */
  function demo() {
    function f(l, e, t, o, a, st) { return { l: l, s: 'Snc', e: e, t: t, o: o, a: a || '', q: 1, m: 2, st: st }; }
    return {
      site: 'SNC Poinsirez (démo)', marques: ['New Holland', 'Case IH', 'John Deere', 'Fendt', 'Manitou', 'JCB', 'Artec', 'Volvo'],
      engins: [{ nom: 'T7 270', marque: 'New Holland', site: 'Snc' }, { nom: '7040', marque: 'New Holland', site: 'Snc' },
        { nom: 'puma 180', marque: 'Case IH', site: 'Snc' }, { nom: 'JD 6630', marque: 'John Deere', site: 'Snc' },
        { nom: 'FENDT 930', marque: 'Fendt', site: 'Snc' }, { nom: 'MANITOU 634', marque: 'Manitou', site: 'Snc' }],
      filtres: [f(2, '7040', 'moteur', '84228488', '', 3), f(3, '7040', 'carb', '84412164', '', 1), f(4, '7040', 'hydrau', '47617638', '87708150', 2),
        f(10, 'T7 270', 'moteur', '84228488', '', 3), f(11, 'T7 270', 'carburant', '84278636', '', 0), f(12, 'T7 270', 'cabine', '87726675', '', 4),
        f(40, 'puma 180', 'moteur', '84228488', '', 3), f(41, 'puma 180', 'air', '87517154', 'kit 73332256', 2),
        f(70, 'JD 6630', 'moteur', 'RE 504836', 'SO 10044', 1), f(71, 'JD 6630', 'carb', 'RE 541922', '', 2),
        f(110, 'FENDT 930', 'moteur', 'F954200510010', '', 2), f(111, 'FENDT 930', 'frein', 'F842880141020', 'x2', 1),
        f(300, 'MANITOU 634', 'moteur', '799966', '', 2), f(301, 'MANITOU 634', 'carb', '799968', '', 0)]
    };
  }

  window.MODULES.filtration = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var S = ctx.site.id, K = cles(S);
      var T = null, attente = [], D = null;          // D = données calculées (listing + attente)
      var ecran = 'marques', marque = null, engin = null, recherche = '', siteFiltre = PM.Prefs.get('fi_site', '');
      var histo = null, histoAnnee = new Date().getFullYear(), histoFiltre = 'Sortie', histoTexte = '';
      var invFiltre = '', invMarque = '', invReste = false;
      var instance = PM.uid();
      window.__fiInstance = instance;
      function actif() { return window.__fiInstance === instance && location.hash.indexOf('outil/' + ctx.outil.id) >= 0; }
      function api(action, extra, delai) {
        if (modeDemo) return Promise.reject(new Error('Mode démonstration : renseigne le serveur du site dans Réglages.'));
        return PM.Api.appeler(ctx.apiUrl, Object.assign({ action: action, cle: ctx.cle }, extra || {}), delai || 60000);
      }
      function recalculer() { D = calculer(T, attente); }

      /* ---------- démarrage ---------- */
      vue.appendChild(el('div', { class: 'fi-attente-page' }, [el('div', { class: 'pm-roue' }), el('div', {}, ['Chargement du listing filtration…'])]));
      Promise.all([PM.DB.get(K.tout), PM.DB.get(K.attente)]).then(function (r) {
        T = r[0] || (modeDemo ? demo() : null);
        attente = r[1] || [];
        if (T) { recalculer(); afficher(); }
        if (!modeDemo) charger(!T);
      });
      var dernierChargement = 0, rechargePrevue = null, rechargeEnAttente = false;
      function charger(premier) {
        dernierChargement = Date.now();
        return api('filtration.tout', {}, 90000).then(function (j) {
          delete j.ok;
          if (T && T.filtres && T.filtres.length && (!j.filtres || !j.filtres.length)) { PM.toast('Listing vide reçu : dernière version gardée.', 4000); return; }
          T = j; PM.DB.set(K.tout, j);
          return nettoyerAttente().then(function () {
            recalculer();
            if (actif() && !document.querySelector('.ag-modale') && !saisieEnCours()) afficher();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le listing filtration.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { vue.innerHTML = ''; vue.appendChild(el('div', { class: 'fi-attente-page' }, [el('div', { class: 'pm-roue' }), el('div', {}, ['Nouvel essai…'])])); charger(true); } }, ['Réessayer']), ' ',
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : listing du dernier chargement', 4000);
        });
      }
      function saisieEnCours() { var a = document.activeElement; return ecran === 'inventaire' && a && a.tagName === 'INPUT'; }
      // toutes les saisies parties -> rechargement (au plus une fois par minute, jamais en plein comptage)
      function rechargerPlusTard() {
        if (!actif() || modeDemo) return;
        if (ecran === 'inventaire') { rechargeEnAttente = true; return; }
        var reste = 60000 - (Date.now() - dernierChargement);
        if (reste <= 0) { rechargeEnAttente = false; charger(false); return; }
        if (!rechargePrevue) rechargePrevue = setTimeout(function () { rechargePrevue = null; rechargerPlusTard(); }, reste);
      }
      PM.Envoi.surChangement(function (n) {
        if (!actif() || n || !attente.length || modeDemo) return;
        rechargerPlusTard();
      });
      var cacheDepuis = 0;
      window.__fiVisibilite && document.removeEventListener('visibilitychange', window.__fiVisibilite);
      window.__fiVisibilite = function () {
        if (document.hidden) { cacheDepuis = Date.now(); return; }
        if (actif() && !modeDemo && cacheDepuis && Date.now() - cacheDepuis > 5 * 60000) { cacheDepuis = 0; rechargerPlusTard(); }
      };
      document.addEventListener('visibilitychange', window.__fiVisibilite);
      function nettoyerAttente() {
        return Promise.all([PM.DB.listerEnvois(), PM.DB.get(K.attente)]).then(function (r) {
          var ids = (r[0] || []).filter(function (x) { return !x.rejete; }).map(function (x) { return x.payload.id; });
          attente = (r[1] || []).filter(function (a) { return ids.indexOf(a.id) >= 0; });
          return PM.DB.set(K.attente, attente);
        });
      }

      /* ---------- saisie : file d'attente + affichage immédiat ---------- */
      function saisir(payload, sansAffichage) {
        var agent = PM.Prefs.get('agent', '');
        if (!agent) { demanderAgent(function () { saisir(payload, sansAffichage); }); return false; }
        payload.id = PM.uid();
        payload.agent = agent;
        payload.date = new Date().toISOString();
        attente.push(payload);
        if (modeDemo) { appliquerDemo(); }
        else { PM.DB.set(K.attente, attente); PM.Envoi.ajouter(S, payload); }
        recalculer();
        if (!sansAffichage) afficher();
        return true;
      }
      function appliquerDemo() {
        // en démonstration, les saisies sont fondues dans les données (rien n'est envoyé)
        var d = calculer(T, attente);
        T = { site: T.site, marques: d.marques.filter(function (m) { return m !== SANS_MARQUE; }), engins: d.engins.map(function (e) { return { nom: e.nom, marque: e.marque, site: e.site }; }),
          filtres: d.lignes.map(function (l) { var r = l.k && d.refs[l.k]; return { l: l.l || 900 + Math.round(Math.random() * 99), s: l.s, e: l.e, t: l.t, o: l.o, a: l.a, q: l.q, m: l.m, st: r ? r.stock : null }; }) };
        attente = [];
      }
      function demanderAgent(suite) {
        var inp = el('input', { type: 'text', placeholder: 'Prénom', autocomplete: 'off' });
        var fermer = modale('Qui fait la saisie ?', 'Ton prénom est noté dans l’historique (une seule fois sur ce téléphone).', [
          el('div', { class: 'champ' }, [inp]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim();
            if (!v) { inp.focus(); return; }
            PM.Prefs.set('agent', v); fermer(); suite();
          } }, ['Continuer'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }

      /* ================= écrans ================= */
      function afficher() {
        if (!actif() || !D) return;
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'stock filtration' });
        vue.appendChild(racine);
        if (modeDemo) racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
          el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Données d’exemple, rien n’est envoyé. Une fois ton appli Filtration branchée (adresse /exec + clé), renseigne-la dans ']), el('a', { href: '#reglages' }, ['Réglages']), '.']));
        racine.appendChild(barreOutils());
        ({ engins: ecranEngins, engin: ecranEngin, inventaire: ecranInventaire, historique: ecranHistorique, commander: ecranCommander }[ecran] || ecranMarques)(racine);
        window.scrollTo(0, y);
      }
      function aller(e, opts) {
        var sortieInventaire = ecran === 'inventaire' && e !== 'inventaire';
        ecran = e;
        if (opts && 'marque' in opts) marque = opts.marque;
        if (opts && 'engin' in opts) engin = opts.engin;
        afficher(); window.scrollTo(0, 0);
        if (sortieInventaire && rechargeEnAttente) rechargerPlusTard();
      }
      function barreOutils() {
        function b(txt, titre, fn, actifSi) {
          return el('button', { class: 'st-outil' + (actifSi ? ' actif' : ''), type: 'button', title: titre, 'aria-label': titre, onclick: fn }, [txt]);
        }
        var nbCmd = Object.keys(D.refs).filter(function (k) { return D.refs[k].bas; }).length;
        return el('div', { class: 'st-outils' }, [
          b('🏷 Marques', 'Marques et engins', function () { aller('marques'); }, ecran === 'marques' || ecran === 'engins' || ecran === 'engin'),
          b('📋 Inventaire', 'Inventaire annuel', function () { aller('inventaire'); }, ecran === 'inventaire'),
          b('📜 Historique', 'Sorties de l’année', function () { aller('historique'); }, ecran === 'historique'),
          b('🛒 À commander' + (nbCmd ? ' (' + nbCmd + ')' : ''), 'Filtres sous le seuil mini', function () { aller('commander'); }, ecran === 'commander')
        ]);
      }
      function sitesConnus() {
        var s = {};
        D.engins.forEach(function (e) { if (e.site) s[e.site] = (s[e.site] || 0) + 1; });
        return Object.keys(s).sort(function (a, b) { return s[b] - s[a]; });
      }
      function enginsVisibles() { return D.engins.filter(function (e) { return !siteFiltre || e.site === siteFiltre; }); }
      function selectSite() {
        var sites = sitesConnus();
        if (sites.length < 2) return null;
        var s = el('select', { class: 'st-filtre fi-site', 'aria-label': 'Site de rattachement' },
          [el('option', { value: '' }, ['Tous les sites'])].concat(sites.map(function (x) { return el('option', { value: x }, [x]); })));
        s.value = siteFiltre;
        s.addEventListener('change', function () { siteFiltre = s.value; PM.Prefs.set('fi_site', siteFiltre); afficher(); });
        return s;
      }

      /* ---------- accueil : les marques ---------- */
      function ecranMarques(racine) {
        var zone = el('div');
        var champRech = el('input', { type: 'search', class: 'st-filtre', placeholder: '🔍 Référence ou engin (ex. 84228488, T7…)', value: recherche, autocomplete: 'off' });
        racine.appendChild(el('div', { class: 'st-actions' }, [champRech, selectSite(),
          el('button', { class: 'btn-second st-mini', type: 'button', onclick: ouvrirAjoutMarque }, ['＋ Marque'])]));
        racine.appendChild(zone);
        function remplir() {
          zone.innerHTML = '';
          var t = norm(recherche), tk = cleRef(recherche);
          if (t) {
            var es = enginsVisibles().filter(function (e) { return norm(e.nom).indexOf(t) >= 0; });
            if (es.length) {
              zone.appendChild(el('div', { class: 'st-sous-titre' }, ['Engins']));
              zone.appendChild(grilleEngins(es));
            }
            var rs = Object.keys(D.refs).map(function (k) { return D.refs[k]; }).filter(function (r) {
              return (tk && r.k.indexOf(tk) >= 0) || norm(r.ref).indexOf(t) >= 0 || r.lignes.some(function (l) { return norm(l.a).indexOf(t) >= 0; });
            });
            if (rs.length) {
              zone.appendChild(el('div', { class: 'st-sous-titre' }, ['Références']));
              zone.appendChild(tableauRefs(rs.slice(0, 60)));
            }
            if (!es.length && !rs.length) zone.appendChild(el('div', { class: 'vide-msg' }, ['Rien trouvé pour « ' + recherche + ' ».']));
            return;
          }
          var vis = enginsVisibles();
          var g = el('div', { class: 'pp-grille fi-marques' });
          D.marques.forEach(function (m, i) {
            var es = vis.filter(function (e) { return e.marque === m; });
            if (m === SANS_MARQUE && !es.length) return;
            var al = es.reduce(function (s, e) { return s + e.nbAlertes; }, 0);
            g.appendChild(el('button', { class: 'pp-carte fi-marque', type: 'button', style: '--i:' + i + ';--m:' + teinte(m), onclick: function () { aller('engins', { marque: m }); } }, [
              el('div', { class: 'fi-marque-tete' }, [el('span', { class: 'fi-logo' }, [m === SANS_MARQUE ? '?' : initiales(m)]), al ? el('span', { class: 'st-pastille', title: al + ' référence(s) sous le seuil' }, [String(al)]) : null]),
              el('div', { class: 'fi-marque-nom' }, [m]),
              el('div', { class: 'petit' }, [es.length ? es.length + ' engin' + (es.length > 1 ? 's' : '') : 'Aucun engin'])]));
          });
          zone.appendChild(g);
          var nbRefs = Object.keys(D.refs).length, sansStock = Object.keys(D.refs).filter(function (k) { return D.refs[k].stock === null; }).length;
          zone.appendChild(el('p', { class: 'petit', style: 'margin-top:14px' }, [D.engins.length + ' engins · ' + nbRefs + ' références de filtres'
            + (sansStock ? ' · ' + sansStock + ' sans stock renseigné (à compter dans l’inventaire)' : '')]));
        }
        remplir();
        champRech.addEventListener('input', function () { recherche = champRech.value; remplir(); });
      }
      function grilleEngins(liste) {
        var g = el('div', { class: 'pp-grille' });
        liste.forEach(function (e, i) {
          var nbF = e.lignes.length;
          g.appendChild(el('button', { class: 'pp-carte st-carte fi-engin', type: 'button', style: '--i:' + i + ';--m:' + teinte(e.marque), onclick: function () { aller('engin', { engin: e.nom, marque: e.marque }); } }, [
            el('div', { class: 'st-carte-tete' }, [el('b', {}, [e.nom]), e.nbAlertes ? el('span', { class: 'st-pastille', title: 'Références sous le seuil' }, [String(e.nbAlertes)]) : null]),
            el('div', { class: 'petit' }, [nbF + ' filtre' + (nbF > 1 ? 's' : '') + (e.site ? ' · ' + e.site : '') + (e.enAttente ? ' · ⏳' : '')])]));
        });
        return g;
      }

      /* ---------- les engins d'une marque ---------- */
      function ecranEngins(racine) {
        var es = enginsVisibles().filter(function (e) { return e.marque === marque; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr', { numeric: true }); });
        racine.appendChild(el('div', { class: 'st-actions' }, [
          el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () { aller('marques'); } }, ['← Marques']),
          el('h2', { class: 'fi-titre', style: '--m:' + teinte(marque) }, [el('span', { class: 'fi-logo' }, [marque === SANS_MARQUE ? '?' : initiales(marque)]), marque]),
          selectSite(),
          el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () { ouvrirEngin(null, marque === SANS_MARQUE ? '' : marque); } }, ['＋ Engin'])]));
        if (marque === SANS_MARQUE) racine.appendChild(el('p', { class: 'petit' }, ['Engins sans marque en colonne J de la feuille : renseigne-la dans la feuille, ou ouvre l’engin puis « 🏷 Changer de marque » (elle est alors écrite en colonne J).']));
        if (!es.length) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucun engin ' + (siteFiltre ? 'sur « ' + siteFiltre + ' » ' : '') + 'pour cette marque.', el('br'), 'Touche « ＋ Engin » pour en ajouter un.'])); return; }
        racine.appendChild(grilleEngins(es));
      }

      /* ---------- les filtres d'un engin ---------- */
      function ecranEngin(racine) {
        var e = D.engins.filter(function (x) { return norm(x.nom) === norm(engin); })[0];
        if (!e) { aller('marques'); return; }
        racine.appendChild(el('div', { class: 'st-actions' }, [
          el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () { aller('engins', { marque: e.marque }); } }, ['← ' + e.marque]),
          el('h2', { class: 'fi-titre', style: '--m:' + teinte(e.marque) }, [e.nom, e.site ? el('span', { class: 'st-badge st-envoi' }, [e.site]) : null])]));
        racine.appendChild(el('div', { class: 'st-actions' }, [
          el('button', { class: 'btn-principal fi-btn', type: 'button', onclick: function () { ouvrirFiltre(e, null); } }, ['＋ Filtre']),
          el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () { ouvrirEngin(e); } }, ['🏷 Changer de marque'])]));
        if (!e.lignes.length) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucun filtre pour cet engin.', el('br'), 'Touche « ＋ Filtre » pour ajouter le premier.'])); return; }
        // un même filtre écrit deux fois pour l'engin (ex. bloc 7040 recopié en bas du listing) n'est affiché qu'une fois
        var vus = {};
        function unique(l) { var c = (l.k || '#' + l.l) + '|' + norm(l.t) + '|' + norm(l.a); if (vus[c]) return false; vus[c] = true; return true; }
        var avecRef = e.lignes.filter(function (l) { return l.k && unique(l); });
        var sansRef = e.lignes.filter(function (l) { return !l.k; });
        function ligneFiltre(l) {
          var r = l.k && D.refs[l.k];
          var autres = r ? r.engins.filter(function (x) { return x !== e.nom; }) : [];
          var adapt = l.a && cleRef(l.a) && D.refs[cleRef(l.a)];
          var cellRef = el('td', {}, [
            el('div', { class: 'st-ref' }, [l.o || (l.a && !texte(l.o) ? l.a : '—')]),
            l.a && l.o ? el('div', { class: 'st-sous' }, ['Adaptable / note : ' + l.a + (adapt && adapt.stock !== null ? ' (stock ' + adapt.stock + ')' : '')]) : null,
            !l.k ? el('div', { class: 'st-sous fi-acompleter' }, ['Référence à compléter']) : null,
            autres.length ? el('div', { class: 'st-sous' }, ['Aussi sur : ' + autres.slice(0, 4).join(', ') + (autres.length > 4 ? '…' : '')]) : null]);
          var cellStock = el('td', { class: 'fi-stock' }, r ? [
            el('button', { class: 'st-qte' + (r.bas ? ' fi-bas' : ''), type: 'button', title: 'Sortie / entrée', onclick: function () { ouvrirMouvement(r, e.nom, l, 'sortie'); } }, [r.stock === null ? '?' : String(r.stock)]),
            el('div', { class: 'st-sous' }, ['mini ' + r.seuil]),
            r.enAttente ? el('span', { class: 'st-badge st-envoi' }, ['⏳']) : null] : ['—']);
          var actions = el('td', { class: 'pp-actions' }, [
            r ? el('button', { class: 'btn-second st-mini fi-sortie', type: 'button', onclick: function () { ouvrirMouvement(r, e.nom, l, 'sortie'); } }, ['− Sortie']) : null,
            r ? el('button', { class: 'pp-icone', type: 'button', title: 'Entrée en stock', onclick: function () { ouvrirMouvement(r, e.nom, l, 'entree'); } }, ['＋']) : null,
            el('button', { class: 'pp-icone', type: 'button', title: 'Modifier', onclick: function () { ouvrirFiltre(e, l); } }, ['✎'])]);
          return el('tr', { class: (r && r.bas ? 'st-bas' : '') + (l.enAttente ? ' attente' : '') }, [
            el('td', {}, [el('b', {}, [l.t || '—']), l.q > 1 ? el('div', { class: 'st-sous' }, ['× ' + l.q + ' par engin']) : null]), cellRef, cellStock, actions]);
        }
        if (avecRef.length) racine.appendChild(tableau(['Filtre', 'Référence', 'Stock', ''], avecRef.map(ligneFiltre), 'fi-table'));
        else racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucune référence connue pour cet engin.']));
        // emplacements prévus dans le listing mais sans référence (frein, cabine x2…) : repliés, à compléter avec ✎
        if (sansRef.length) racine.appendChild(el('details', { class: 'bandeau fi-details' }, [
          el('summary', {}, ['Filtres sans référence (' + sansRef.length + ') — à compléter']),
          tableau(['Filtre', 'Référence', 'Stock', ''], sansRef.map(ligneFiltre), 'fi-table')]));
      }
      function tableauRefs(liste) {
        return tableau(['Référence', 'Engins', 'Stock', ''], liste.map(function (r) {
          return el('tr', { class: r.bas ? 'st-bas' : '' }, [
            el('td', {}, [el('div', { class: 'st-ref' }, [r.ref]), el('div', { class: 'st-sous' }, [r.types.join(', ')])]),
            el('td', {}, [el('div', { class: 'fi-liens' }, r.engins.map(function (n) {
              return el('button', { class: 'fi-lien', type: 'button', onclick: function () { var x = D.engins.filter(function (e) { return e.nom === n; })[0]; aller('engin', { engin: n, marque: x ? x.marque : marque }); } }, [n]);
            }))]),
            el('td', {}, [el('button', { class: 'st-qte' + (r.bas ? ' fi-bas' : ''), type: 'button', onclick: function () { ouvrirMouvement(r, r.engins[0], r.lignes[0], 'sortie'); } }, [r.stock === null ? '?' : String(r.stock)]),
              el('div', { class: 'st-sous' }, ['mini ' + r.seuil])]),
            el('td', { class: 'pp-actions' }, [el('button', { class: 'btn-second st-mini fi-sortie', type: 'button', onclick: function () { ouvrirMouvement(r, r.engins[0], r.lignes[0], 'sortie'); } }, ['− Sortie'])])]);
        }), 'fi-table');
      }

      /* ---------- fenêtre sortie / entrée ---------- */
      function ouvrirMouvement(r, nomEngin, ligne, sens) {
        var qte = Math.max(1, Number(ligne && ligne.q) || 1), motif = null;
        var champQte = el('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', value: String(qte), class: 'st-compte fi-qte', 'aria-label': 'Quantité' });
        var choixEngin = el('select', { class: 'st-select' }, r.engins.map(function (n) { return el('option', { value: n }, [n]); }));
        choixEngin.value = nomEngin;
        var zoneMotifs = el('div', { class: 'st-motifs' });
        var info = el('div', { class: 'petit', style: 'margin-bottom:10px' });
        var bSortie = el('button', { class: 'st-sens', type: 'button', onclick: function () { sens = 'sortie'; maj(); } }, ['− Sortie']);
        var bEntree = el('button', { class: 'st-sens', type: 'button', onclick: function () { sens = 'entree'; maj(); } }, ['＋ Entrée']);
        var valider = el('button', { class: 'btn-principal', type: 'button' }, ['Valider']);
        function maj() {
          bSortie.classList.toggle('actif', sens === 'sortie'); bEntree.classList.toggle('actif', sens === 'entree');
          var motifs = sens === 'sortie' ? MOTIFS_SORTIE : MOTIFS_ENTREE;
          if (motifs.indexOf(motif) < 0) motif = motifs[0];
          zoneMotifs.innerHTML = '';
          motifs.forEach(function (m) { zoneMotifs.appendChild(el('button', { class: 'st-chip' + (m === motif ? ' actif' : ''), type: 'button', onclick: function () { motif = m; maj(); } }, [m])); });
          var q = entier(champQte.value, 1), st = r.stock === null ? 0 : r.stock;
          var apres = isNaN(q) ? null : Math.max(0, st + (sens === 'sortie' ? -q : q));
          info.textContent = 'Stock actuel : ' + (r.stock === null ? 'non renseigné' : r.stock) + (apres === null ? '' : ' → après : ' + apres)
            + (sousSeuil(apres, r.seuil) ? '  ⚠ au seuil mini ou en dessous (' + r.seuil + ') : alerte' : '');
          info.style.color = sousSeuil(apres, r.seuil) ? 'var(--attente)' : '';
          if (sens === 'sortie' && r.stock !== null && !isNaN(q) && q > r.stock) info.textContent += ' — le stock indiqué est plus petit que la sortie : il sera mis à 0.';
          valider.textContent = sens === 'sortie' ? 'Valider la sortie' : 'Valider l’entrée';
        }
        champQte.addEventListener('input', maj);
        var fermer = modale(r.ref, r.types.join(', ') + ' · ' + r.engins.join(', '), [
          el('div', { class: 'st-sens-ligne' }, [bSortie, bEntree]),
          el('div', { class: 'st-pm', style: 'justify-content:center;margin-bottom:10px' }, [
            el('button', { type: 'button', onclick: function () { var q = entier(champQte.value, 1); champQte.value = String(Math.max(1, (isNaN(q) ? 1 : q) - 1)); maj(); } }, ['−']),
            champQte,
            el('button', { type: 'button', onclick: function () { var q = entier(champQte.value, 1); champQte.value = String((isNaN(q) ? 0 : q) + 1); maj(); } }, ['+'])]),
          r.engins.length > 1 ? champ('Engin', choixEngin) : null,
          zoneMotifs, info, valider]);
        valider.addEventListener('click', function () {
          var q = entier(champQte.value, 1);
          if (isNaN(q)) { champQte.focus(); return; }
          if (saisir({ type: 'filtration.mouvement', reference: r.ref, engin: choixEngin.value || nomEngin, sens: sens, quantite: q, motif: motif })) {
            fermer();
            PM.toast((sens === 'sortie' ? 'Sortie de ' : 'Entrée de ') + q + ' × ' + r.ref + ' enregistrée');
          } else fermer();
        });
        maj();
      }

      /* ---------- ajout / modification ---------- */
      function ouvrirAjoutMarque() {
        var inp = el('input', { type: 'text', placeholder: 'ex. Claas, Merlo, Kubota…', autocomplete: 'off' });
        var msg = el('div', { class: 'petit', style: 'color:var(--alerte)' });
        var fermer = modale('Nouvelle marque', 'Elle apparaît tout de suite dans la liste des marques.', [champ('Nom de la marque', inp), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var n = texte(inp.value);
            if (!n) { inp.focus(); return; }
            if (D.marques.map(norm).indexOf(norm(n)) >= 0) { msg.textContent = 'Cette marque existe déjà.'; return; }
            fermer(); saisir({ type: 'filtration.marque', nom: n });
          } }, ['Ajouter la marque'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }
      function ouvrirEngin(e, marqueDefaut) {
        var nom = el('input', { type: 'text', placeholder: 'ex. T7 270, JD 6630…', autocomplete: 'off', value: e ? e.nom : '' });
        if (e) nom.readOnly = true;
        var choixMarque = el('select', { class: 'st-select' }, D.marques.filter(function (m) { return m !== SANS_MARQUE; }).map(function (m) { return el('option', { value: m }, [m]); })
          .concat([el('option', { value: '__nouvelle' }, ['＋ Autre marque…'])]));
        choixMarque.value = e ? (e.marque === SANS_MARQUE ? D.marques[0] : e.marque) : (marqueDefaut || D.marques[0]);
        var nouvelle = el('input', { type: 'text', placeholder: 'Nom de la nouvelle marque', autocomplete: 'off', hidden: true });
        choixMarque.addEventListener('change', function () { nouvelle.hidden = choixMarque.value !== '__nouvelle'; if (!nouvelle.hidden) nouvelle.focus(); });
        var sites = sitesConnus();
        var site = el('input', { type: 'text', list: 'fi-sites', placeholder: 'ex. Snc', value: e ? e.site : (siteFiltre || sites[0] || 'Snc'), autocomplete: 'off' });
        var dl = el('datalist', { id: 'fi-sites' }, sites.map(function (s) { return el('option', { value: s }); }));
        var msg = el('div', { class: 'petit', style: 'color:var(--alerte)' });
        var fermer = modale(e ? 'Marque de l’engin' : 'Nouvel engin', e ? e.nom : 'Ensuite, ajoute ses filtres avec « ＋ Filtre ».', [
          champ('Nom de l’engin', nom), champ('Marque', choixMarque), nouvelle, champ('Site de rattachement', site), dl, msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var n = texte(nom.value), m = choixMarque.value === '__nouvelle' ? texte(nouvelle.value) : choixMarque.value;
            if (!n) { nom.focus(); return; }
            if (!m) { nouvelle.focus(); return; }
            if (!e && D.engins.some(function (x) { return norm(x.nom) === norm(n); })) { msg.textContent = 'Un engin porte déjà ce nom.'; return; }
            fermer();
            if (saisir({ type: 'filtration.engin', nom: n, marque: m, site: texte(site.value) }, true)) aller('engin', { engin: n, marque: m });
          } }, [e ? 'Enregistrer' : 'Créer l’engin'])]);
        if (!e) setTimeout(function () { nom.focus(); }, 30);
      }
      function ouvrirFiltre(e, l) {
        var types = {};
        D.lignes.forEach(function (x) { var t = norm(x.t); if (t && !types[t]) types[t] = texte(x.t); });
        var dl = el('datalist', { id: 'fi-types' }, Object.keys(types).sort().map(function (t) { return el('option', { value: types[t] }); }));
        var type = el('input', { type: 'text', list: 'fi-types', placeholder: 'moteur, carb, hydrau, air, cabine…', value: l ? l.t : '', autocomplete: 'off' });
        var origine = el('input', { type: 'text', placeholder: 'ex. 84228488', value: l ? l.o : '', autocomplete: 'off', autocapitalize: 'characters' });
        var adapt = el('input', { type: 'text', placeholder: 'ex. SO 3349 (facultatif)', value: l ? l.a : '', autocomplete: 'off' });
        var r0 = l && l.k ? D.refs[l.k] : null;
        var qte = el('input', { type: 'number', inputmode: 'numeric', min: '1', value: String(l && l.q ? l.q : 1) });
        var seuil = el('input', { type: 'number', inputmode: 'numeric', min: '0', value: String(r0 ? r0.seuil : (l && l.m !== null && l.m !== undefined ? l.m : 2)) });
        var stock = el('input', { type: 'number', inputmode: 'numeric', min: '0', placeholder: 'facultatif' });
        var info = el('div', { class: 'petit', style: 'margin:-6px 0 12px' });
        function majInfo() {
          var k = cleRef(origine.value) || (texte(origine.value) ? '' : cleRef(adapt.value)), r = k && D.refs[k];
          info.textContent = r ? 'Référence déjà connue (' + r.engins.join(', ') + ') : stock commun ' + (r.stock === null ? 'non renseigné' : r.stock) + ', seuil ' + r.seuil + '.'
            : (k ? 'Nouvelle référence.' : (texte(origine.value) ? 'Ce n’est pas une référence (il faut au moins un chiffre).' : ''));
          stock.parentNode && (stock.parentNode.hidden = !!r || !!l);
        }
        origine.addEventListener('input', majInfo); adapt.addEventListener('input', majInfo);
        var contenu = [dl, champ('Filtre', type), champ('Référence d’origine', origine), info, champ('Adaptable / note', adapt),
          el('div', { class: 'fi-deux' }, [champ('Quantité par engin', qte), champ('Seuil mini', seuil, 'Mail d’alerte sous ce stock')]),
          champ('Stock actuel', stock)];
        var fermer;
        contenu.push(el('button', { class: 'btn-principal', type: 'button', onclick: function () {
          var t = texte(type.value), o = texte(origine.value), a = texte(adapt.value);
          var q = entier(qte.value, 1), s = entier(seuil.value, 0), st = texte(stock.value) ? entier(stock.value, 0) : null;
          if (!t) { type.focus(); return; }
          if (!o && !a) { origine.focus(); return; }
          if (isNaN(q)) { qte.focus(); return; }
          if (isNaN(s)) { seuil.focus(); return; }
          fermer();
          if (l) saisir({ type: 'filtration.modifFiltre', ligne: l.l, engin: e.nom, avantOrigine: l.o, avantType: l.t, type2: t, origine: o, adaptable: a, qte: q, seuil: s });
          else {
            var k = cleRef(o) || (o ? '' : cleRef(a));
            saisir({ type: 'filtration.filtre', engin: e.nom, site: e.site, type2: t, origine: o, adaptable: a, qte: q, seuil: s, stock: k && D.refs[k] ? null : (isNaN(st) ? null : st) });
          }
        } }, [l ? 'Enregistrer' : 'Ajouter le filtre']));
        if (l && l.l) contenu.push(el('button', { class: 'btn-second st-large', type: 'button', onclick: function () {
          if (!window.confirm('Retirer « ' + (l.t || '') + ' ' + (l.o || l.a) + ' » de ' + e.nom + ' ?\n(La ligne est vidée dans la feuille, l’historique est gardé.)')) return;
          fermer(); saisir({ type: 'filtration.supprimerFiltre', ligne: l.l, engin: e.nom, avantOrigine: l.o, avantType: l.t });
        } }, ['🗑 Retirer ce filtre de l’engin']));
        fermer = modale(l ? 'Modifier le filtre' : 'Nouveau filtre', e.nom, contenu);
        majInfo();
        if (!l) setTimeout(function () { type.focus(); }, 30);
      }

      /* ---------- inventaire annuel ---------- */
      function cleInv() { return 'fi_inv_' + S + '_' + new Date().getFullYear(); }
      function ecranInventaire(racine) {
        var comptes = PM.Prefs.get(cleInv(), {}) || {};
        var refs = Object.keys(D.refs).map(function (k) { return D.refs[k]; });
        function marqueDe(r) { var e = D.engins.filter(function (x) { return x.nom === r.engins[0]; })[0]; return e ? e.marque : SANS_MARQUE; }
        refs.forEach(function (r) { r.marque = marqueDe(r); });
        refs.sort(function (a, b) { return D.marques.indexOf(a.marque) - D.marques.indexOf(b.marque) || a.ref.localeCompare(b.ref, 'fr', { numeric: true }); });
        var total = refs.length;
        var barre = el('div', { class: 'fi-progres' }, [el('span')]);
        var compteur = el('div', { class: 'fi-progres-txt' });
        var btnValider = el('button', { class: 'btn-principal fi-btn', type: 'button' });
        function nbFaits() { return Object.keys(comptes).filter(function (k) { return D.refs[k]; }).length; }
        function majProgres() {
          var n = nbFaits();
          barre.firstChild.style.width = (total ? Math.round(n * 100 / total) : 0) + '%';
          compteur.textContent = n + ' / ' + total + ' références comptées';
          btnValider.textContent = '✔ Valider l’inventaire (' + n + ')';
          btnValider.disabled = !n;
        }
        racine.appendChild(el('div', { class: 'bandeau fi-inv-tete' }, [
          el('div', { style: 'font-weight:700' }, ['📋 Inventaire annuel ' + new Date().getFullYear()]),
          el('p', { class: 'petit' }, ['Compte chaque référence sur l’étagère et tape la quantité. Le comptage est gardé sur ce téléphone (même appli fermée) jusqu’à « Valider ». Une référence montée sur plusieurs engins ne se compte qu’une fois.']),
          barre, compteur]));
        var champRech = el('input', { type: 'search', class: 'st-filtre', placeholder: '🔍 Référence, filtre ou engin', value: invFiltre, autocomplete: 'off' });
        var choixMarque = el('select', { class: 'st-filtre' }, [el('option', { value: '' }, ['Toutes les marques'])].concat(D.marques.map(function (m) { return el('option', { value: m }, [m]); })));
        choixMarque.value = invMarque;
        var reste = el('button', { class: 'st-chip' + (invReste ? ' actif' : ''), type: 'button', onclick: function () { invReste = !invReste; reste.classList.toggle('actif', invReste); remplir(); } }, ['Pas encore comptées']);
        racine.appendChild(el('div', { class: 'st-actions' }, [champRech, choixMarque, reste]));
        var zone = el('div');
        racine.appendChild(zone);
        racine.appendChild(el('div', { class: 'st-actions fi-inv-bas' }, [btnValider,
          el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () {
            if (!nbFaits() || !window.confirm('Effacer tout le comptage en cours sur ce téléphone ?')) return;
            comptes = {}; PM.Prefs.set(cleInv(), comptes); remplir(); majProgres();
          } }, ['Effacer le comptage'])]));
        function remplir() {
          zone.innerHTML = '';
          var t = norm(invFiltre), tk = cleRef(invFiltre);
          var vues = refs.filter(function (r) {
            if (invMarque && r.marque !== invMarque) return false;
            if (invReste && comptes[r.k] !== undefined) return false;
            return !t || (tk && r.k.indexOf(tk) >= 0) || norm(r.ref + ' ' + r.types.join(' ') + ' ' + r.engins.join(' ')).indexOf(t) >= 0;
          });
          if (!vues.length) { zone.appendChild(el('div', { class: 'vide-msg' }, [invReste ? 'Tout est compté 👍' : 'Aucune référence.'])); return; }
          zone.appendChild(tableau(['Référence', 'Théorique', 'Compté'], vues.map(function (r) {
            var inp = el('input', { type: 'number', inputmode: 'numeric', min: '0', class: 'st-compte', value: comptes[r.k] !== undefined ? String(comptes[r.k]) : '', 'aria-label': 'Quantité comptée ' + r.ref });
            var ecart = el('span', { class: 'st-ecart' });
            var tr = el('tr', {}, [
              el('td', {}, [el('div', { class: 'st-ref' }, [r.ref]), el('div', { class: 'st-sous' }, [r.types.join(', ') + ' · ' + r.engins.slice(0, 3).join(', ') + (r.engins.length > 3 ? '…' : '')])]),
              el('td', {}, [r.stock === null ? '—' : String(r.stock)]),
              el('td', {}, [el('div', { class: 'st-pm' }, [
                el('button', { type: 'button', tabindex: '-1', onclick: function () { var v = entier(inp.value, 0); inp.value = String(Math.max(0, (isNaN(v) ? 1 : v) - 1)); noter(); } }, ['−']),
                inp,
                el('button', { type: 'button', tabindex: '-1', onclick: function () { var v = entier(inp.value, 0); inp.value = String((isNaN(v) ? 0 : v) + 1); noter(); } }, ['+'])]), ecart])]);
            function noter() {
              var v = entier(inp.value, 0);
              if (texte(inp.value) === '' || isNaN(v)) delete comptes[r.k]; else comptes[r.k] = v;
              PM.Prefs.set(cleInv(), comptes);
              tr.classList.toggle('st-fait', comptes[r.k] !== undefined);
              ecart.textContent = comptes[r.k] === undefined || r.stock === null || comptes[r.k] === r.stock ? '' : (comptes[r.k] > r.stock ? '+' : '') + (comptes[r.k] - r.stock);
              ecart.className = 'st-ecart ' + (comptes[r.k] > r.stock ? 'st-plus' : 'st-moins');
              majProgres();
            }
            inp.addEventListener('input', noter);
            inp.addEventListener('keydown', function (ev) {   // « Entrée » passe à la ligne suivante
              if (ev.key !== 'Enter') return;
              ev.preventDefault();
              var tous = zone.querySelectorAll('input.st-compte'), i = Array.prototype.indexOf.call(tous, inp);
              if (tous[i + 1]) tous[i + 1].focus(); else inp.blur();
            });
            if (comptes[r.k] !== undefined) setTimeout(noter, 0);
            return tr;
          }), 'st-inventaire fi-inv'));
        }
        btnValider.addEventListener('click', function () {
          var ks = Object.keys(comptes).filter(function (k) { return D.refs[k]; });
          if (!ks.length) return;
          var ecarts = ks.filter(function (k) { return D.refs[k].stock !== comptes[k]; }).length;
          if (!window.confirm('Valider l’inventaire de ' + ks.length + ' référence' + (ks.length > 1 ? 's' : '') + ' ?\n' + ecarts + ' stock' + (ecarts > 1 ? 's' : '') + ' vont changer.\nLes envois partent tout seuls (même sans réseau maintenant).')) return;
          var agent = PM.Prefs.get('agent', '');
          if (!agent) { demanderAgent(function () { btnValider.click(); }); return; }
          ks.forEach(function (k) { saisir({ type: 'filtration.inventaire', reference: D.refs[k].ref, compte: comptes[k], engin: D.refs[k].engins[0] }, true); });
          comptes = {}; PM.Prefs.set(cleInv(), comptes);
          PM.toast('Inventaire enregistré : ' + ks.length + ' références', 4000);
          aller('commander');
        });
        champRech.addEventListener('input', function () { invFiltre = champRech.value; remplir(); });
        choixMarque.addEventListener('change', function () { invMarque = choixMarque.value; remplir(); });
        remplir(); majProgres();
      }

      /* ---------- à commander ---------- */
      function ecranCommander(racine) {
        var bas = Object.keys(D.refs).map(function (k) { return D.refs[k]; }).filter(function (r) { return r.bas; })
          .sort(function (a, b) { return b.aCommander - a.aCommander || a.ref.localeCompare(b.ref); });
        var inconnus = Object.keys(D.refs).filter(function (k) { return D.refs[k].stock === null; }).length;
        racine.appendChild(el('div', { class: 'bandeau' }, [
          el('div', { style: 'font-weight:700' }, ['🛒 Filtres au seuil mini ou en dessous (' + bas.length + ')']),
          el('p', { class: 'petit' }, ['Un mail part tout seul vers ' + (T.email || 'l’adresse d’alerte') + ' quand une référence passe sous son seuil.'
            + (inconnus ? ' ' + inconnus + ' référence' + (inconnus > 1 ? 's n’ont' : ' n’a') + ' pas encore de stock : fais l’inventaire.' : '')])]));
        if (!bas.length) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Rien à commander 👍'])); return; }
        racine.appendChild(el('div', { class: 'st-actions' }, [el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () {
          var txt = 'Filtres à commander — ' + (ctx.site.nom || '') + '\n' + bas.map(function (r) { return '• ' + r.ref + ' (' + r.types.join(', ') + ')' + (r.aCommander ? ' × ' + r.aCommander : ' — au seuil (stock ' + r.stock + ')'); }).join('\n');
          if (navigator.share) navigator.share({ title: 'Filtres à commander', text: txt })['catch'](function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { PM.toast('Liste copiée : colle-la dans WhatsApp ou un mail.'); });
        } }, ['📤 Partager la liste'])]));
        racine.appendChild(tableau(['Référence', 'Engins', 'Stock', 'À cmd'], bas.map(function (r) {
          return el('tr', { class: 'st-bas' }, [
            el('td', {}, [el('div', { class: 'st-ref' }, [r.ref]), el('div', { class: 'st-sous' }, [r.types.join(', ')])]),
            el('td', {}, [el('div', { class: 'fi-liens' }, r.engins.map(function (n) {
              return el('button', { class: 'fi-lien', type: 'button', onclick: function () { var x = D.engins.filter(function (e) { return e.nom === n; })[0]; aller('engin', { engin: n, marque: x ? x.marque : '' }); } }, [n]);
            }))]),
            el('td', {}, [el('button', { class: 'st-qte fi-bas', type: 'button', onclick: function () { ouvrirMouvement(r, r.engins[0], r.lignes[0], 'entree'); } }, [String(r.stock)]), el('div', { class: 'st-sous' }, ['mini ' + r.seuil])]),
            el('td', {}, [el('b', { class: 'st-acommander' }, [String(r.aCommander)])])]);
        }), 'fi-table'));
      }

      /* ---------- historique : sorties de l'année ---------- */
      var histoEnCours = {};
      function chargerHisto(annee) {
        var k = K.histo + annee;
        if (histoEnCours[annee]) return histoEnCours[annee];
        return (histoEnCours[annee] = PM.DB.get(k).then(function (h) {
          if (h && histoAnnee === annee) { histo = h; if (ecran === 'historique') afficher(); }
          if (modeDemo) { histo = histo || { annee: annee, lignes: [], annees: [annee] }; if (ecran === 'historique') afficher(); return; }
          return api('filtration.historique', { annee: annee }, 60000).then(function (j) {
            delete j.ok; PM.DB.set(k, j);
            if (histoAnnee === annee) { histo = j; if (actif() && ecran === 'historique' && !document.querySelector('.ag-modale')) afficher(); }
          })['catch'](function (e) {
            if (!histo) { histo = { annee: annee, lignes: [], annees: [annee], erreur: (PM.raison ? PM.raison(e) : 'Hors ligne') + ' : ' + e.message }; if (ecran === 'historique') afficher(); }
            else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : historique du dernier chargement', 4000);
          });
        }).then(function () { delete histoEnCours[annee]; }, function () { delete histoEnCours[annee]; }));
      }
      function ecranHistorique(racine) {
        if (!histo || histo.annee !== histoAnnee) {
          histo = null; chargerHisto(histoAnnee);
          racine.appendChild(el('div', { class: 'fi-attente-page' }, [el('div', { class: 'pm-roue' }), el('div', {}, ['Chargement de l’historique ' + histoAnnee + '…'])]));
          return;
        }
        // mouvements faits sur ce téléphone et pas encore confirmés par le serveur
        var locales = attente.filter(function (a) { return (a.type === 'filtration.mouvement' || a.type === 'filtration.inventaire') && new Date(a.date).getFullYear() === histoAnnee; })
          .map(function (a) { return { d: a.date, a: a.type === 'filtration.inventaire' ? 'Inventaire' : (a.sens === 'entree' ? 'Entrée' : 'Sortie'), e: a.engin, r: a.reference, x: a.motif || '', q: a.type === 'filtration.inventaire' ? a.compte : a.quantite, g: a.agent, local: true }; })
          .reverse();
        var toutes = locales.concat(histo.lignes || []);
        var annees = (histo.annees || [histoAnnee]).slice();
        if (annees.indexOf(histoAnnee) < 0) annees.unshift(histoAnnee);
        var choixAnnee = el('select', { class: 'st-filtre fi-annee', 'aria-label': 'Année' }, annees.map(function (a) { return el('option', { value: String(a) }, [String(a)]); }));
        choixAnnee.value = String(histoAnnee);
        choixAnnee.addEventListener('change', function () { histoAnnee = Number(choixAnnee.value); histo = null; afficher(); });
        var champRech = el('input', { type: 'search', class: 'st-filtre', placeholder: '🔍 Référence, engin, prénom…', value: histoTexte, autocomplete: 'off' });
        racine.appendChild(el('div', { class: 'st-actions' }, [choixAnnee, champRech]));
        racine.appendChild(el('div', { class: 'st-motifs' }, [['Sortie', '− Sorties'], ['Entrée', '＋ Entrées'], ['Inventaire', '📋 Inventaire'], ['', 'Tout']].map(function (f) {
          return el('button', { class: 'st-chip' + (histoFiltre === f[0] ? ' actif' : ''), type: 'button', onclick: function () { histoFiltre = f[0]; afficher(); } }, [f[1]]);
        })));
        if (histo.erreur) racine.appendChild(el('p', { class: 'petit', style: 'color:var(--attente)' }, ['⚠ ' + histo.erreur]));
        var zone = el('div');
        racine.appendChild(zone);
        function remplir() {
          zone.innerHTML = '';
          var t = norm(histoTexte);
          var vues = toutes.filter(function (h) {
            if (histoFiltre && h.a !== histoFiltre) return false;
            return !t || norm([h.r, h.e, h.g, h.x].join(' ')).indexOf(t) >= 0;
          });
          // résumé des sorties de l'année
          var sorties = toutes.filter(function (h) { return h.a === 'Sortie' && (!t || norm([h.r, h.e, h.g, h.x].join(' ')).indexOf(t) >= 0); });
          var totalQ = sorties.reduce(function (s, h) { return s + (Number(h.q) || 0); }, 0);
          var parRef = {}, parEngin = {};
          sorties.forEach(function (h) {
            var k = cleRef(h.r) || h.r;
            parRef[k] = parRef[k] || { ref: h.r, q: 0, n: 0, engins: {} }; parRef[k].q += Number(h.q) || 0; parRef[k].n++; if (h.e) parRef[k].engins[h.e] = true;
            if (h.e) parEngin[h.e] = (parEngin[h.e] || 0) + (Number(h.q) || 0);
          });
          var top = Object.keys(parRef).map(function (k) { return parRef[k]; }).sort(function (a, b) { return b.q - a.q; });
          var topE = Object.keys(parEngin).map(function (k) { return { e: k, q: parEngin[k] }; }).sort(function (a, b) { return b.q - a.q; });
          zone.appendChild(el('div', { class: 'fi-resume' }, [
            el('div', { class: 'fi-chiffre' }, [el('b', {}, [String(totalQ)]), el('span', {}, ['filtres sortis en ' + histoAnnee])]),
            el('div', { class: 'fi-chiffre' }, [el('b', {}, [String(sorties.length)]), el('span', {}, ['sorties'])]),
            el('div', { class: 'fi-chiffre' }, [el('b', {}, [String(top.length)]), el('span', {}, ['références'])]),
            el('div', { class: 'fi-chiffre' }, [el('b', {}, [String(topE.length)]), el('span', {}, ['engins'])])]));
          if (top.length && histoFiltre === 'Sortie') {
            var details = el('details', { class: 'bandeau fi-details', open: 'open' }, [el('summary', {}, ['Les plus sorties en ' + histoAnnee]),
              el('div', { class: 'fi-barres' }, top.slice(0, 12).map(function (r) {
                var ref = D.refs[cleRef(r.ref)];
                return el('div', { class: 'fi-barre' }, [
                  el('div', { class: 'fi-barre-txt' }, [el('span', { class: 'st-ref' }, [r.ref]), el('span', { class: 'st-sous' }, [(ref ? ref.types.join(', ') + ' · ' : '') + Object.keys(r.engins).join(', ')])]),
                  el('div', { class: 'fi-barre-val' }, [el('span', { style: 'width:' + Math.max(6, Math.round(r.q * 100 / top[0].q)) + '%' }), el('b', {}, [String(r.q)])])]);
              }))]);
            zone.appendChild(details);
            if (topE.length > 1) zone.appendChild(el('details', { class: 'bandeau fi-details' }, [el('summary', {}, ['Sorties par engin']),
              el('div', { class: 'fi-barres' }, topE.map(function (x) {
                return el('div', { class: 'fi-barre' }, [el('div', { class: 'fi-barre-txt' }, [el('b', {}, [x.e])]),
                  el('div', { class: 'fi-barre-val' }, [el('span', { style: 'width:' + Math.max(6, Math.round(x.q * 100 / topE[0].q)) + '%' }), el('b', {}, [String(x.q)])])]);
              }))]));
          }
          if (!vues.length) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Aucun mouvement' + (histoFiltre ? ' « ' + histoFiltre.toLowerCase() + ' »' : '') + ' en ' + histoAnnee + '.'])); return; }
          zone.appendChild(el('div', { class: 'st-sous-titre' }, ['Détail (' + vues.length + ')']));
          zone.appendChild(tableau(['Date', 'Mouvement', 'Qté'], vues.slice(0, 400).map(function (h) {
            return el('tr', { class: h.local ? 'attente' : '' }, [
              el('td', {}, [dateCourte(h.d), h.g ? el('div', { class: 'st-sous' }, [h.g]) : null]),
              el('td', {}, [el('div', {}, [el('span', { class: h.a === 'Sortie' ? 'st-moins' : (h.a === 'Entrée' ? 'st-plus' : '') }, [h.a]), ' ', el('span', { class: 'st-ref' }, [h.r || ''])]),
                el('div', { class: 'st-sous' }, [[h.e, h.x].filter(Boolean).join(' · ') + (h.local ? ' · ⏳ en attente d’envoi' : '')])]),
              el('td', {}, [h.q === null || h.q === undefined ? '' : String(h.q), h.s !== null && h.s !== undefined && h.a !== 'Inventaire' ? el('div', { class: 'st-sous' }, ['→ ' + h.s]) : null])]);
          }), 'fi-table'));
          if (vues.length > 400) zone.appendChild(el('p', { class: 'petit' }, ['… 400 premières lignes affichées : affine la recherche.']));
        }
        champRech.addEventListener('input', function () { histoTexte = champRech.value; remplir(); });
        remplir();
      }
    }
  };
})();
