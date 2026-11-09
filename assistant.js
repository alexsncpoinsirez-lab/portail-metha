/* =====================================================================
   MODULE « ASSISTANT MAINTENANCE » — questions écrites ou dictées sur
   le carnet d'interventions, réponse de l'IA (Claude) lue à voix haute
   au besoin, avec les interventions citées. Nécessite le réseau.
   La clé API reste sur le serveur du site (jamais sur le téléphone).
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var SUGGESTIONS = [
    'Quelles sont les 5 dernières interventions ?',
    'Tous les combien d’heures change-t-on le stator du Premix 2 ?',
    'Qu’a-t-on déjà fait sur le séparateur ?',
    'Trouve-moi le schéma électrique de la Rotte',
    'Combien de stators Wangen reste-t-il en stock ?'
  ];
  var Reco = window.SpeechRecognition || window.webkitSpeechRecognition;

  function fmtDate(s) { var d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : String(s || '—'); }
  function fmtNb(v) { var n = PM.nombre(v); return n === null || isNaN(n) ? String(v || '') : Math.round(n).toLocaleString('fr-FR'); }

  window.MODULES.assistant = {
    afficher: function (vue, ctx) {
      var CLE_CONV = 'assistant_conv_' + ctx.site.id;
      var conv = []; // { q, r, refs, erreur, enCours }
      var tous = PM.Prefs.get('assistant_tous_' + ctx.site.id, false);
      var parler = PM.Prefs.get('assistant_voix', false);
      var enCours = false;

      PM.DB.get(CLE_CONV).then(function (c) { if (Array.isArray(c)) conv = c.filter(function (x) { return !x.enCours; }).slice(-20); afficher(); });

      function sauver() { PM.DB.set(CLE_CONV, conv.filter(function (x) { return !x.enCours; }).slice(-20)); }

      function lireAVoixHaute(t) {
        if (!('speechSynthesis' in window) || !t) return;
        try {
          speechSynthesis.cancel();
          var u = new SpeechSynthesisUtterance(t.replace(/[#*_]/g, ''));
          u.lang = 'fr-FR'; u.rate = 1.05;
          speechSynthesis.speak(u);
        } catch (e) {}
      }

      function afficher() {
        vue.innerHTML = '';
        var racine = el('div', { class: 'assistant' });
        vue.appendChild(racine);
        if (!ctx.apiUrl) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Serveur non réglé. ']), el('span', { class: 'petit' }, ['Renseigne le serveur du site dans ']), el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        // options
        var optTous = el('label', { class: 'as-option' }, [el('input', { type: 'checkbox', checked: tous ? 'checked' : null, onchange: function (e) { tous = e.target.checked; PM.Prefs.set('assistant_tous_' + ctx.site.id, tous); } }), ' Les deux sites']);
        var optVoix = 'speechSynthesis' in window ? el('label', { class: 'as-option' }, [el('input', { type: 'checkbox', checked: parler ? 'checked' : null, onchange: function (e) { parler = e.target.checked; PM.Prefs.set('assistant_voix', parler); if (!parler && window.speechSynthesis) speechSynthesis.cancel(); } }), ' Lire les réponses']) : null;
        racine.appendChild(el('div', { class: 'as-options' }, [optTous, optVoix,
          conv.length ? el('button', { type: 'button', class: 'as-lien', onclick: function () { conv = []; sauver(); if (window.speechSynthesis) speechSynthesis.cancel(); afficher(); } }, ['Nouvelle conversation']) : null]));

        var fil = el('div', { class: 'as-fil' });
        racine.appendChild(fil);
        if (!conv.length) {
          fil.appendChild(el('div', { class: 'as-accueil' }, [
            el('div', { class: 'as-titre' }, ['Pose ta question sur les interventions']),
            el('p', { class: 'petit' }, ['L’assistant répond à partir du carnet d’interventions' + (tous ? ' des deux sites' : ' de ' + ctx.site.nom) + ' et cite les interventions utilisées. Pour une panne, décris les symptômes : il rappelle ce qui a déjà été fait et propose des pistes.']),
            el('div', { class: 'as-suggestions' }, SUGGESTIONS.map(function (s) { return el('button', { type: 'button', class: 'zone-chip', onclick: function () { poser(s); } }, [s]); }))
          ]));
        }
        conv.forEach(function (x) {
          fil.appendChild(el('div', { class: 'as-bulle as-q' }, [x.q]));
          if (x.enCours) { fil.appendChild(el('div', { class: 'as-bulle as-r as-attente' }, [el('span', { class: 'as-points' }, ['●', '●', '●']), ' Je cherche (carnet, outils, documents)… jusqu’à 2 min'])); return; }
          if (x.erreur) { fil.appendChild(el('div', { class: 'as-bulle as-r as-erreur' }, ['⚠ ' + x.erreur, el('br'), el('button', { type: 'button', class: 'as-lien', onclick: function () { conv.splice(conv.indexOf(x), 1); poser(x.q); } }, ['Réessayer'])])); return; }
          var b = el('div', { class: 'as-bulle as-r' }, [el('div', { class: 'as-texte' }, [x.r])]);
          if (x.docs && x.docs.length) {
            b.appendChild(el('div', { class: 'as-docs' }, x.docs.map(function (d) {
              return el('a', { class: 'as-doc', href: d.lien, target: '_blank', rel: 'noopener' }, [(/^📁/.test(d.nom) ? '' : '📄 ') + d.nom]);
            })));
          }
          if (x.consult && x.consult.length) b.appendChild(el('div', { class: 'as-consult' }, ['Consulté : ' + x.consult.join(' · ')]));
          var actions = el('div', { class: 'as-actions' });
          if ('speechSynthesis' in window) actions.appendChild(el('button', { type: 'button', class: 'as-lien', onclick: function () { lireAVoixHaute(x.r); } }, ['🔊 Écouter']));
          if (x.refs && x.refs.length) {
            var det = el('details', { class: 'as-refs' }, [el('summary', {}, ['📒 ' + x.refs.length + (x.refs.length > 1 ? ' interventions citées' : ' intervention citée')])]);
            x.refs.forEach(function (l) {
              var bas = [l.par ? '👤 ' + l.par : '', l.heures !== '' && l.heures !== undefined && l.heures !== null ? '⏱ ' + fmtNb(l.heures) + ' h' : '', l.tonnage !== '' && l.tonnage !== undefined && l.tonnage !== null ? fmtNb(l.tonnage) + ' t' : ''].filter(Boolean).join(' · ');
              det.appendChild(el('div', { class: 'as-ref' }, [
                el('div', { class: 'as-ref-tete' }, [el('b', {}, [l.lieu || '—']), el('span', { class: 'petit' }, [fmtDate(l.date) + (tous && l.site ? ' · ' + l.site : '')])]),
                l.prob ? el('div', {}, ['⚠ ' + l.prob]) : null,
                l.interv ? el('div', {}, ['🔧 ' + l.interv]) : null,
                l.efficace ? el('div', { class: 'petit' }, ['Efficace : ' + l.efficace]) : null,
                bas ? el('div', { class: 'petit' }, [bas]) : null
              ]));
            });
            b.appendChild(det);
          }
          b.appendChild(actions);
          fil.appendChild(b);
        });

        // zone de saisie
        var champ = el('textarea', { rows: '2', class: 'as-champ', placeholder: 'Ta question… (ou touche 🎤)' });
        champ.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyer(); } });
        function envoyer() { var q = champ.value.trim(); if (q) poser(q); }
        var micro = null;
        if (Reco) {
          var r = null;
          micro = el('button', { type: 'button', class: 'as-micro', 'aria-label': 'Dicter la question' }, ['🎤']);
          micro.onclick = function () {
            if (r) { r.stop(); return; }
            try {
              r = new Reco(); r.lang = 'fr-FR'; r.interimResults = true; r.continuous = false;
              var base = champ.value.trim();
              r.onresult = function (e) {
                var t = Array.prototype.map.call(e.results, function (x) { return x[0].transcript; }).join(' ').trim();
                champ.value = (base ? base + ' ' : '') + t;
                if (e.results[e.results.length - 1].isFinal) { r.stop(); }
              };
              r.onerror = function (e) { if (e.error === 'not-allowed') PM.toast('Micro refusé : autorise-le dans le navigateur'); };
              r.onend = function () { r = null; micro.classList.remove('actif'); if (champ.value.trim() && champ.value.trim() !== base) envoyer(); };
              r.start(); micro.classList.add('actif');
            } catch (err) { r = null; PM.toast('Dictée indisponible : utilise le micro du clavier'); }
          };
        }
        var bouton = el('button', { type: 'button', class: 'as-envoyer', disabled: enCours ? 'disabled' : null, onclick: envoyer, 'aria-label': 'Envoyer' }, ['➤']);
        racine.appendChild(el('div', { class: 'as-saisie' }, [champ, micro, bouton]));
        var dernier = fil.lastElementChild;
        if (dernier && conv.length) dernier.scrollIntoView({ block: 'start' });
      }

      function poser(q) {
        if (enCours) return;
        if (!ctx.apiUrl) { PM.toast('Serveur du site non réglé (Réglages)'); return; }
        if (!navigator.onLine) { PM.toast('Pas de réseau : l’assistant a besoin d’internet'); return; }
        if (window.speechSynthesis) speechSynthesis.cancel();
        var x = { q: q, enCours: true };
        var historique = conv.filter(function (c) { return c.r && !c.erreur; }).slice(-3).map(function (c) { return { q: c.q, r: c.r }; });
        conv.push(x); enCours = true; afficher();
        PM.Api.appeler(ctx.apiUrl, { action: 'assistant.question', cle: ctx.cle, question: q, historique: historique, tous: tous }, 180000).then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.erreur) || 'Réponse vide du serveur');
          x.r = j.reponse; x.refs = j.references || []; x.consult = j.consultations || [];
          x.docs = (j.documents || []).filter(function (d) { return d && /^https:\/\/(drive|docs)\.google\.com\//.test(d.lien || ''); });
          if (parler) lireAVoixHaute(x.r);
        })['catch'](function (e) {
          x.erreur = (PM.raison ? PM.raison(e) + ' — ' : '') + (e && e.message || 'erreur');
          if (/Action inconnue/.test(x.erreur)) x.erreur = 'Le serveur du site n’a pas encore l’assistant : coller le COMPLET à jour et faire une nouvelle version.';
        }).then(function () { delete x.enCours; enCours = false; sauver(); afficher(); });
      }
    }
  };
})();
