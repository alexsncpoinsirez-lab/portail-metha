/* =====================================================================
   MODULE « RONDE JOURNALIÈRE » — Métha de la Rotte — version rapide
   Même déroulé que l'appli d'origine :
   - un point de contrôle à la fois, réponse = passage au point suivant ;
   - « Précédent » pour corriger (une réponse déjà envoyée est remplacée) ;
   - notes entre parenthèses cliquables, photos de référence, bandeau
     « Dernière fois : … » si le point était en alerte au dernier passage ;
   - photos multiples, bip + vibration, « Merci … pour la ronde ! » ;
   - envoi groupé par zone, reprise de la ronde du jour, sans réseau ;
   - onglets Tableau de bord et Messagerie.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;

  /* Points de démonstration : utilisés tant que le serveur n'est pas réglé */
  var DEMO = {
    nomSite: 'Métha de la Rotte (démo)',
    derniereRonde: { date: '01/10/2026 09:11', agent: 'Mathieu', duree: 272 },
    agents: ['Mathieu', 'Charles', 'Thibaut'],
    points: [
      { zone: 'Supervision', libelle: 'Contrôle courbe production J-1', notes: [], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [] },
      { zone: 'Supervision', libelle: 'Contrôle des alarmes', notes: [], reponses: ['Absence de défaut', 'Présence de défaut réparation effectuée', 'Présence de défaut réparation différée'], reponsesAlerte: ['Présence de défaut réparation effectuée', 'Présence de défaut réparation différée'], photos: [] },
      { zone: 'Supervision', libelle: 'Contrôle T° cuves', notes: ['45°'], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [], derniereAlerte: true, derniereReponseAlerte: 'Non conforme' },
      { zone: 'Supervision', libelle: 'Contrôle valeurs gaz avant charbon', notes: ['CH4 50-54%', 'O2 0,6%', 'H2S réagir si la valeur est au dessus de 250 ppm'], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [] },
      { zone: 'Incorporation', libelle: 'Contrôle usure vis verticale', notes: [], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [] },
      { zone: 'Salle cogé', libelle: 'Contrôle fonctionnement groupe froid +', notes: ['T1° 2 à 5', 'T2° 18 à 20', 'P1° 2,5 à 3 bar', 'P2° 2 bar'], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [], derniereAlerte: true, derniereReponseAlerte: 'Non conforme', derniersNonConformes: ['T1° 2 à 5'], derniereDate: '04/11 09:22', dernierAgent: 'Mathieu' },
      { zone: 'Incorporation', libelle: 'Nettoyage des fonds poussant', notes: [], reponses: ['Effectué', 'Reporté'], reponsesAlerte: ['Reporté'], photos: [], derniereAlerte: true, derniereReponseAlerte: 'Reporté' }
    ]
  };

  function jourCourant() { return new Date().toDateString(); }
  function cleDuPoint(p) { return p.zone + '||' + p.libelle; }

  /* Bip + vibration à chaque réponse (comme l'original) */
  var audio = null;
  function debloquerAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }
  function vibrerEtBip() {
    if (navigator.vibrate) navigator.vibrate(150);
    try {
      if (!audio) return;
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.15);
    } catch (e) {}
  }
  function direMerci(prenom) {
    if (!window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(prenom ? 'Merci ' + prenom + ' pour la ronde !' : 'Merci pour la ronde !');
      u.lang = 'fr-FR'; window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* Réduit une photo avant envoi (1280 px, JPEG) */
  function compresserPhoto(fichier) {
    return new Promise(function (ok, ko) {
      var lecteur = new FileReader();
      lecteur.onerror = ko;
      lecteur.onload = function () {
        var img = new Image();
        img.onerror = ko;
        img.onload = function () {
          var r = Math.min(1, 1280 / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', 0.72));
        };
        img.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }
  // Lien vers une photo : seulement http(s) (jamais « javascript: » venu d'une cellule du Sheet)
  function lienSur(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null; }
  function visionneuse(src) {
    var m = estVideo(src)
      ? el('video', { src: lienVideo(src), autoplay: 'autoplay', loop: 'loop', muted: 'muted', playsinline: 'playsinline', controls: 'controls' })
      : el('img', { src: lienImage(src), alt: '' });
    if (m.tagName === 'VIDEO') m.muted = true;
    var v = el('div', { class: 'visionneuse', onclick: function (e) { if (e.target !== m) v.remove(); } }, [m]);
    document.body.appendChild(v);
  }
  // Vidéo de référence : lien marqué « video: » par le serveur, ou fichier .mp4/.webm/.mov
  function estVideo(u) { return /^video:/i.test(u) || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u); }
  // Identifiant d'un fichier Drive dans un lien (partage, open?id=, uc?id=, thumbnail?id=)
  function idDrive(u) {
    var m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{20,})/);
    return m ? m[1] : null;
  }
  function lienVideo(u) {
    u = String(u).replace(/^video:\s*/i, '');
    var id = idDrive(u);
    return id ? 'https://drive.google.com/uc?export=download&id=' + id : u;
  }
  // lien Drive « partager » → image affichable (au cas où le serveur ne l'a pas déjà fait)
  function lienImage(u) {
    var id = idDrive(u);
    return id && !/thumbnail\?id=/.test(u) ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000' : u;
  }
  // Drive refuse parfois la lecture directe : on passe alors par son lecteur intégré
  function lecteurDrive(id, alt) {
    return el('iframe', { src: 'https://drive.google.com/file/d/' + id + '/preview', title: alt || 'Vidéo de référence',
      allow: 'autoplay; fullscreen', allowfullscreen: 'allowfullscreen', loading: 'lazy', class: 'ronde-video-drive' });
  }
  // Une vidéo par lien, gardée tant qu'on reste sur le même point : elle ne redémarre pas
  // à chaque toucher d'un paramètre (l'écran est redessiné), et s'arrête au point suivant.
  var videosPoint = { cle: null, el: {} };
  function videoReference(cle, u, alt, surErreur) {
    if (videosPoint.cle !== cle) {
      Object.keys(videosPoint.el).forEach(function (k) { try { videosPoint.el[k].pause(); } catch (e) {} });
      videosPoint = { cle: cle, el: {} };
    }
    if (!u) return null;
    var v = videosPoint.el[u];
    if (!v) {
      var id = idDrive(u), etat = videosPoint;
      var secours = function () {
        // lecture directe impossible : lecteur Drive si c'est un fichier Drive, sinon on retire la vidéo
        if (etat.el[u] !== v || v.tagName !== 'VIDEO') return;
        if (!id) { surErreur.call(v); return; }
        var f = lecteurDrive(id, alt);
        etat.el[u] = f;
        if (v.parentNode) v.parentNode.replaceChild(f, v);
      };
      v = el('video', { src: lienVideo(u), autoplay: 'autoplay', loop: 'loop', muted: 'muted', playsinline: 'playsinline', preload: 'auto',
        'aria-label': alt, onclick: function () { visionneuse(u); }, onerror: secours });
      v.muted = true; // obligatoire pour la lecture automatique sur téléphone
      // Drive renvoie parfois une page au lieu de la vidéo, sans erreur : au bout de 8 s sans image, lecteur Drive
      setTimeout(function () { if (v.readyState < 2) secours(); }, 8000);
      videosPoint.el[u] = v;
    }
    if (v.tagName === 'VIDEO') setTimeout(function () { try { var r = v.play(); if (r && r['catch']) r['catch'](function () {}); } catch (e) {} }, 0);
    return v;
  }

  window.MODULES.rondes = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_CFG = 'ronde2_cfg_' + ctx.site.id;
      var CLE_BROUILLON = 'ronde2_brouillon_' + ctx.site.id;
      var config = null, R = null, onglet = 'ronde', index = 0, enFin = false, recapFin = null;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' }),
        el('p', { class: 'petit', style: 'text-align:center' }, ['Chargement des points de contrôle…'])]));
      Promise.all([PM.DB.get(CLE_CFG), PM.DB.get(CLE_BROUILLON)]).then(function (r) {
        config = r[0] || (modeDemo ? DEMO : null);
        R = r[1] && r[1].jour === jourCourant() ? r[1] : null;
        if (!modeDemo) rafraichir(!config);
        if (config) demarrer();
      })['catch'](probleme);

      // En cas de souci, on affiche la cause au lieu de rester bloqué sur l'écran de chargement
      function probleme(e) {
        console.error('Ronde :', e);
        vue.innerHTML = '';
        vue.appendChild(el('div', { class: 'vide-msg' }, [
          'La ronde n’a pas pu s’afficher.', el('br'),
          el('span', { class: 'petit' }, [String(e && e.message || e)]), el('br'), el('br'),
          el('button', { class: 'btn-second', onclick: function () {
            Promise.all([PM.DB.del(CLE_CFG)]).then(function () { location.reload(); });
          } }, ['Recharger les points depuis le serveur']), el('br'), el('br'),
          el('button', { class: 'btn-second', onclick: function () {
            if (!confirm('Effacer la ronde en cours sur cet appareil ? Les réponses déjà envoyées restent dans la feuille.')) return;
            Promise.all([PM.DB.del(CLE_CFG), PM.DB.del(CLE_BROUILLON)]).then(function () { location.reload(); });
          } }, ['Repartir de zéro sur cet appareil'])
        ]));
      }

      function rafraichir(premier) {
        PM.Api.appeler(ctx.apiUrl, { action: 'config', cle: ctx.cle }, 45000).then(function (j) {
          delete j.ok;
          if (!j.points || !j.points.length) throw new Error('Aucun point de contrôle actif reçu du serveur.');
          var change = JSON.stringify(j) !== JSON.stringify(config);
          config = j; PM.DB.set(CLE_CFG, j);
          if (change && onglet === 'ronde' && !enFin) { try { demarrer(); } catch (err) { probleme(err); } }
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger les points de contrôle.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : points de contrôle du dernier chargement', 4000);
        });
      }

      function sauver() { if (R) PM.DB.set(CLE_BROUILLON, R); }

      /* Zones contiguës dans l'ordre des points (comme regrouperParZone_) */
      function zones() {
        var z = [];
        config.points.forEach(function (p, i) {
          var d = z[z.length - 1];
          if (d && d.nom === p.zone) d.indices.push(i); else z.push({ nom: p.zone, indices: [i] });
        });
        return z;
      }
      function zoneDe(i) { return zones().filter(function (z) { return z.indices.indexOf(i) >= 0; })[0]; }
      function rep(i) { return R.reponses[cleDuPoint(config.points[i])]; }

      function demarrer() {
        if (!R) R = { jour: jourCourant(), agent: PM.Prefs.get('agent', ''), debut: null, reponses: {} };
        index = config.points.length;
        for (var i = 0; i < config.points.length; i++) { var x = rep(i); if (!x || !x.reponse) { index = i; break; } }
        enFin = false;
        afficher();
      }

      /* ---------- habillage : onglets ---------- */
      function afficher() {
        vue.innerHTML = '';
        if (modeDemo) {
          vue.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var tabs = el('div', { class: 'onglets', role: 'tablist' });
        [['ronde', 'Ronde du jour'], ['dashboard', 'Tableau de bord'], ['messagerie', 'Messagerie']].forEach(function (t) {
          tabs.appendChild(el('button', { role: 'tab', class: onglet === t[0] ? 'actif' : '', onclick: function () { onglet = t[0]; afficher(); } }, [t[1]]));
        });
        vue.appendChild(tabs);
        if (onglet === 'ronde') { if (enFin) ecranFin(); else ecranRonde(); }
        else if (onglet === 'dashboard') ecranDashboard();
        else ecranMessagerie();
      }

      /* ---------- RONDE : un point à la fois ---------- */
      function ecranRonde() {
        var total = config.points.length;
        // Agent
        var champAgent = el('input', { type: 'text', placeholder: 'Ton prénom', value: R.agent || '' });
        champAgent.addEventListener('change', function () { R.agent = champAgent.value.trim(); PM.Prefs.set('agent', R.agent); sauver(); });
        var agentsRapides = el('div', { class: 'agents' }, (config.agents || []).slice(0, 5).map(function (a) {
          return el('button', { class: 'btn-second' + (a === R.agent ? ' actif' : ''), onclick: function () { R.agent = a; PM.Prefs.set('agent', a); sauver(); afficher(); } }, [a]);
        }));
        var dr = config.derniereRonde;
        vue.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Agent effectuant la ronde']), champAgent, R.agent ? null : agentsRapides,
          dr ? el('div', { class: 'petit' }, ['Dernière ronde : ' + dr.date + ' · ' + dr.agent + (dr.duree ? ' · ' + dr.duree + ' min' : '')]) : null]));

        if (!total) { vue.appendChild(el('div', { class: 'vide-msg' }, ['Aucun point de contrôle actif. Vérifie la feuille PointsControle.'])); return; }
        if (index >= total) { terminer(); return; }

        // Progression
        vue.appendChild(el('div', { class: 'ronde-progress' }, [el('div', { style: 'width:' + Math.round(index / total * 100) + '%' })]));
        vue.appendChild(el('div', { class: 'ronde-nav' }, [
          el('button', { class: 'ronde-precedent', disabled: index === 0 ? 'disabled' : null, onclick: function () { if (index > 0) { index--; afficher(); } } }, ['◀ Précédent']),
          el('span', { class: 'petit' }, ['Point ' + (index + 1) + ' / ' + total])
        ]));

        var p = config.points[index], cle = cleDuPoint(p);
        var x = R.reponses[cle] || (R.reponses[cle] = { reponse: null, photos: [], idSaisie: PM.uid(), envoye: false });
        ncDe(p, x);
        var avant = p.derniersNonConformes || [];

        var carte = el('div', { class: 'bandeau ronde-carte' });
        if (p.derniereAlerte) carte.appendChild(el('div', { class: 'ronde-badge-alerte' }, [
          '⚠ Dernière fois' + (p.derniereDate ? ' (' + p.derniereDate + (p.dernierAgent ? ' · ' + p.dernierAgent : '') + ')' : '') + ' : ' + p.derniereReponseAlerte,
          avant.length ? el('div', { class: 'ronde-badge-detail' }, ['Non conforme : ' + avant.join(' · ')]) : null]));
        carte.appendChild(el('div', { class: 'ronde-zone' }, [p.zone]));
        carte.appendChild(el('h2', { class: 'ronde-libelle' }, [p.libelle]));

        // Paramètres (textes entre parenthèses du libellé) : on touche ceux qui ne sont PAS conformes.
        // En rouge pâle : jugé non conforme au dernier contrôle.
        if (p.notes && p.notes.length) {
          var notes = el('div', { class: 'ronde-notes' + (x.relance ? ' ronde-notes-relance' : '') });
          notes.appendChild(el('div', { class: 'ronde-notes-titre' }, [p.notes.length > 1
            ? 'Paramètres à contrôler — touche celui ou ceux qui ne sont pas conformes'
            : 'Paramètre à contrôler — touche-le s’il n’est pas conforme']));
          p.notes.forEach(function (n) {
            var choisi = x.nonConformes.indexOf(n) >= 0, ancien = avant.indexOf(n) >= 0;
            notes.appendChild(el('div', { class: 'ronde-note' + (choisi ? ' selectionnee' : '') + (ancien ? ' derniere-nc' : ''), role: 'button', 'aria-pressed': choisi ? 'true' : 'false', onclick: function () {
              var k = x.nonConformes.indexOf(n);
              if (k >= 0) x.nonConformes.splice(k, 1); else x.nonConformes.push(n);
              x.relance = false; sauver(); afficher();
            } }, [
              el('span', { class: 'ronde-note-coche' }, [choisi ? '✖' : '']),
              el('span', { class: 'ronde-note-texte' }, [n]),
              choisi ? el('span', { class: 'ronde-note-etat' }, ['Non conforme'])
                : ancien ? el('span', { class: 'ronde-note-etat' }, ['⚠ Non conforme au dernier contrôle']) : null
            ]));
          });
          if (x.relance) notes.appendChild(el('div', { class: 'ronde-notes-aide' }, ['Quel paramètre n’est pas conforme ? Touche-le, ou réappuie sur « ' + x.relance + ' » pour valider sans préciser.']));
          carte.appendChild(notes);
        }

        // Photos de référence
        var refs = (p.photos || []).filter(function (u) { return u.indexOf('ID_DU_FICHIER') < 0; });
        if (refs.length) {
          // autant de photos que de paramètres : chaque photo porte le nom de son paramètre (même ordre)
          var legendes = p.notes && p.notes.length > 1 && p.notes.length === refs.length;
          carte.appendChild(el('div', { class: 'ronde-refs' + (refs.length > 1 ? ' multiples' : '') + (legendes ? ' legendees' : '') }, refs.map(function (u, k) {
            var alt = legendes ? p.notes[k] : 'Photo de référence';
            var img = estVideo(u)
              ? videoReference(cle, u, alt, function () { var b = legendes ? this.parentNode : this; if (b && b.parentNode) b.parentNode.removeChild(b); })
              : el('img', { src: lienImage(u), alt: alt, loading: 'lazy', onclick: function () { visionneuse(u); }, onerror: function () { (legendes ? this.parentNode : this).remove(); } });
            if (!legendes) return img;
            var nc = x.nonConformes.indexOf(p.notes[k]) >= 0;
            return el('figure', { class: 'ronde-ref' + (nc ? ' nc' : '') }, [img, el('figcaption', {}, [p.notes[k]])]);
          })));
        }

        // Photos de la réponse (une ou plusieurs)
        var input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: 'multiple', style: 'display:none' });
        input.addEventListener('change', function () {
          var fichiers = Array.prototype.slice.call(input.files || []);
          if (!fichiers.length) return;
          PM.toast('Préparation de la photo…', 1200);
          Promise.all(fichiers.map(compresserPhoto)).then(function (ds) {
            x.photos = (x.photos || []).concat(ds); x.photosNouvelles = true; sauver(); afficher();
          })['catch'](function () { PM.toast('Photo illisible'); });
        });
        var miniatures = el('div', { class: 'ronde-miniatures' }, (x.photos || []).map(function (src, k) {
          return el('div', { class: 'ronde-mini' }, [
            el('img', { src: src, alt: '', onclick: function () { visionneuse(src); } }),
            el('button', { class: 'ronde-mini-x', 'aria-label': 'Retirer', onclick: function () { x.photos.splice(k, 1); sauver(); afficher(); } }, ['✕'])
          ]);
        }));
        carte.appendChild(el('div', { class: 'ronde-photo' }, [input, el('button', { class: 'btn-photo', onclick: function () { input.click(); } }, ['📷 Ajouter une photo']), miniatures]));

        // Réponses : un clic = enregistré + point suivant
        var grille = el('div', { class: 'reponses' });
        p.reponses.forEach(function (r) {
          var estAlerte = p.reponsesAlerte.indexOf(r) >= 0;
          grille.appendChild(el('button', { class: 'rep' + (x.reponse === r ? ' choisi' : '') + (estAlerte ? ' alerte' : ''), onclick: function () {
            debloquerAudio();
            repondre(index, r);
          } }, [r]));
        });
        carte.appendChild(grille);
        if (x.envoye) carte.appendChild(el('div', { class: 'petit', style: 'margin-top:8px' }, ['✓ Déjà envoyé — une nouvelle réponse remplacera la précédente.']));
        vue.appendChild(carte);
      }

      // Paramètres cochés non conformes (reprend l'ancienne « note » d'une ronde commencée avant la mise à jour)
      function ncDe(p, x) {
        if (!Array.isArray(x.nonConformes)) x.nonConformes = x.note && (p.notes || []).indexOf(x.note) >= 0 ? [x.note] : [];
        delete x.note;
        return x.nonConformes;
      }
      // envoyés seulement si la réponse est une alerte (« Conforme » = tout est bon)
      function ncEnvoyes(p, x) {
        return p.reponsesAlerte.indexOf(x.reponse) >= 0 ? ncDe(p, x).filter(function (n) { return (p.notes || []).indexOf(n) >= 0; }) : [];
      }

      function payload(i) {
        var p = config.points[i], x = rep(i);
        return {
          type: 'reponse', idSaisie: x.idSaisie, agent: R.agent || '', horodatage: x.horodatage,
          zone: p.zone, libelle: p.libelle, reponse: x.reponse, reponsesAlerte: p.reponsesAlerte,
          commentaire: ncEnvoyes(p, x).join(' | '), nonConformes: ncEnvoyes(p, x), photos: x.photosNouvelles ? (x.photos || []) : [],
          photoNomFichier: p.libelle.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
        };
      }
      function envoyer(i) {
        var x = rep(i), pl = payload(i);
        if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, pl, pl.photos.length > 0);
        x.envoye = true; x.photosNouvelles = false;
      }

      function repondre(i, r) {
        var x = rep(i), p = config.points[i];
        ncDe(p, x);
        var estAlerte = p.reponsesAlerte.indexOf(r) >= 0, nbNotes = (p.notes || []).length;
        if (estAlerte && nbNotes === 1 && !x.nonConformes.length) x.nonConformes = [p.notes[0]]; // un seul paramètre : c'est lui
        if (estAlerte && nbNotes > 1 && !x.nonConformes.length && x.relance !== r) {
          // plusieurs paramètres et aucun choisi : on demande lequel (2e appui = valider sans préciser)
          x.relance = r; sauver(); afficher();
          if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
          var bloc = document.querySelector('.ronde-notes'); if (bloc && bloc.scrollIntoView) bloc.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        x.relance = false;
        if (!estAlerte) x.nonConformes = [];
        videoReference(null, '', '', null); // coupe la vidéo du point qu'on quitte
        if (!R.debut) R.debut = new Date().toISOString();
        x.reponse = r; x.horodatage = new Date().toISOString();
        vibrerEtBip();
        if (x.envoye) {
          // Correction d'un point déjà envoyé : renvoi immédiat (la ligne sera remplacée)
          envoyer(i); sauver(); PM.toast('Réponse corrigée');
          afficher(); return;
        }
        var z = zoneDe(i);
        if (z.indices[z.indices.length - 1] === i) z.indices.forEach(function (k) { if (rep(k) && rep(k).reponse && !rep(k).envoye) envoyer(k); });
        sauver();
        index = i + 1;
        // Saute les points déjà répondus (retour en arrière puis reprise)
        while (index < config.points.length && rep(index) && rep(index).reponse && rep(index).envoye) index++;
        afficher();
        window.scrollTo(0, 0);
      }

      /* ---------- Fin de ronde ---------- */
      function terminer() {
        // Points répondus mais pas encore envoyés (zone incomplète) : on envoie tout
        config.points.forEach(function (p, i) { var x = rep(i); if (x && x.reponse && !x.envoye) envoyer(i); });
        var fin = new Date().toISOString();
        var nb = 0, alertes = 0;
        config.points.forEach(function (p, i) { var x = rep(i); if (x && x.reponse) { nb++; if (p.reponsesAlerte.indexOf(x.reponse) >= 0) alertes++; } });
        var idFin = null;
        if (!modeDemo && R.debut) { idFin = PM.uid(); PM.Envoi.ajouter(ctx.site.id, { id: idFin, type: 'finRonde', agent: R.agent || '', debut: R.debut, fin: fin }); }
        recapFin = { nb: nb, alertes: alertes, duree: R.debut ? Math.max(0, Math.round((new Date(fin) - new Date(R.debut)) / 60000)) : null,
          idFin: idFin, debut: R.debut };
        direMerci(R.agent);
        R = null; PM.DB.del(CLE_BROUILLON);
        enFin = true;
        afficher();
      }

      function ecranFin() {
        var statut = el('div', { class: 'petit' });
        var resultat = el('div', { style: 'margin-top:8px' });
        var demande = false;
        function maj(n) {
          statut.textContent = modeDemo ? 'Mode démo : rien n’a été envoyé.'
            : (n ? (navigator.onLine ? 'Envoi en cours… (' + n + ' restant)' : 'Pas de réseau : envoi automatique dès le retour du réseau (' + n + ' en attente).')
                 : 'Tout est enregistré dans la feuille Google ✓' + (recapFin.alertes && !recapFin.idFin ? ' — alertes WhatsApp regroupées envoyées si le seuil est atteint.' : ''));
          // tout est parti : on demande au serveur si les alertes WhatsApp sont parties et s'il y a eu un souci (photo…)
          if (!n && !modeDemo && recapFin.idFin && !demande) { demande = true; resultatServeur(); }
        }
        function resultatServeur() {
          PM.Api.appeler(ctx.apiUrl, { action: 'rondeResultat', cle: ctx.cle, idFin: recapFin.idFin, depuis: recapFin.debut }, 30000).then(function (j) {
            resultat.innerHTML = '';
            var lignes = [];
            if (j.connu && j.alertesEnvoyees) lignes.push(['petit', '📣 ' + j.alertesEnvoyees + ' alerte(s) WhatsApp envoyée(s) au groupe.']);
            if (j.connu && j.alertesEnAttente) lignes.push(['bg-erreur', '⚠ Alerte WhatsApp non envoyée (' + j.alertesEnAttente + ' point(s) en anomalie répétée) : nouvel essai à la fin de la prochaine ronde.']);
            (j.soucis || []).slice(0, 5).forEach(function (s) { lignes.push(['bg-erreur', '⚠ ' + s.message]); });
            if (j.connu && !lignes.length && recapFin.alertes) lignes.push(['petit', 'Aucune alerte WhatsApp à envoyer (seuil de répétition non atteint).']);
            lignes.forEach(function (l) { resultat.appendChild(el('div', { class: l[0] }, [l[1]])); });
          })['catch'](function () { /* ancien serveur ou pas de réseau : on garde le message général */ });
        }
        PM.Envoi.surChangement(maj); PM.Envoi.compter().then(maj);
        vue.appendChild(el('div', { class: 'bandeau', style: 'text-align:center;padding:28px 16px' }, [
          el('div', { style: 'font-size:22px;font-weight:800' }, ['✅ Ronde terminée']),
          el('p', {}, [recapFin.nb + ' point(s) renseigné(s), ' + (recapFin.alertes ? recapFin.alertes + ' réponse(s) en anomalie' : 'aucune alerte') + (recapFin.duree !== null ? ' · Durée : ' + recapFin.duree + ' min' : '') + '.']),
          statut, resultat, el('div', { style: 'height:12px' }),
          el('button', { class: 'btn-principal', onclick: function () { enFin = false; R = null; demarrer(); if (!modeDemo) rafraichir(false); } }, ['Démarrer une nouvelle ronde'])
        ]));
      }

      /* ---------- Tableau de bord (en ligne) ---------- */
      function ecranDashboard() {
        var zone = el('div', {}, [el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])]);
        vue.appendChild(zone);
        if (modeDemo) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Disponible une fois le serveur réglé.'])); return; }
        PM.Api.appeler(ctx.apiUrl, { action: 'dashboard', cle: ctx.cle }, 30000).then(function (s) {
          zone.innerHTML = '';
          zone.appendChild(el('div', { class: 'ronde-stats' }, [
            [s.nbJoursAvecRonde30j, 'jours de ronde (30 j)'], [s.tauxCompletionMoyen + '%', 'taux de complétion moyen'],
            [s.totalEntrees30j, 'relevés (30 j)'], [s.messagesOuverts, 'message(s) non traité(s)']
          ].map(function (c) { return el('div', { class: 'bandeau ronde-stat' }, [el('div', { class: 'ronde-stat-val' }, [String(c[0])]), el('div', { class: 'petit' }, [c[1]])]); })));
          zone.appendChild(el('h3', { class: 'ronde-h3' }, ['Alertes les plus fréquentes (30 j)']));
          zone.appendChild(s.topAlertes.length ? el('div', {}, s.topAlertes.map(function (a) {
            return el('div', { class: 'bandeau ronde-ligne' }, [el('div', {}, [el('b', {}, [a.zone + ' — ' + a.libelle]), el('div', { class: 'petit' }, ['réponse : ' + a.reponse])]), el('span', { class: 'ronde-compte' }, [a.occurrences + '×'])]);
          })) : el('p', { class: 'petit' }, ['Aucune alerte récurrente sur les 30 derniers jours.']));
          zone.appendChild(el('h3', { class: 'ronde-h3' }, ['Dernières alertes']));
          zone.appendChild(s.dernieresAlertes.length ? el('div', {}, s.dernieresAlertes.map(function (a) {
            var photos = String(a.photoUrl || '').split('\n').map(lienSur).filter(Boolean);
            return el('div', { class: 'bandeau ronde-anomalie' }, [
              el('b', {}, [a.zone + ' — ' + a.libelle]),
              el('div', { class: 'petit' }, [a.horodatage + ' · ' + a.agent + ' · réponse : ' + a.reponse]),
              a.commentaire ? el('div', { class: 'petit' }, [a.commentaire]) : null,
              photos.length ? el('div', {}, photos.map(function (u, k) { return el('a', { href: u, target: '_blank', rel: 'noopener', class: 'ronde-lien-photo' }, ['📷 ' + (photos.length > 1 ? 'Photo ' + (k + 1) : 'Voir la photo')]); })) : null
            ]);
          })) : el('p', { class: 'petit' }, ['Aucune alerte récente.']));
        })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Tableau de bord indisponible (réseau ?)', el('br'), el('span', { class: 'petit' }, [e.message])])); });
      }

      /* ---------- Messagerie (bugs / améliorations) ---------- */
      function ecranMessagerie() {
        var type = el('select', {}, ['Bug', 'Amélioration'].map(function (t) { return el('option', { value: t }, [t]); }));
        var texte = el('textarea', { rows: '4', placeholder: 'Décris le problème ou l’idée…' });
        vue.appendChild(el('div', { class: 'bandeau' }, [
          el('h3', { class: 'ronde-h3', style: 'margin-top:0' }, ['Signaler un bug ou une amélioration']),
          el('div', { class: 'champ' }, [el('label', {}, ['Type']), type]),
          el('div', { class: 'champ' }, [el('label', {}, ['Message']), texte]),
          el('button', { class: 'btn-principal', onclick: function () {
            var t = texte.value.trim();
            if (!t) { PM.toast('Écris un message avant d’envoyer.'); return; }
            if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, { type: 'message', agent: PM.Prefs.get('agent', ''), typeMessage: type.value, texte: t, horodatage: new Date().toISOString() });
            texte.value = '';
            PM.toast(modeDemo ? 'Démo : message non envoyé' : 'Message envoyé');
            setTimeout(chargerListe, 2500);
          } }, ['Envoyer'])
        ]));
        var liste = el('div');
        vue.appendChild(el('h3', { class: 'ronde-h3' }, ['Historique']));
        vue.appendChild(liste);
        function chargerListe() {
          if (modeDemo) { liste.innerHTML = ''; liste.appendChild(el('p', { class: 'petit' }, ['Disponible une fois le serveur réglé.'])); return; }
          PM.Api.appeler(ctx.apiUrl, { action: 'messages', cle: ctx.cle }, 25000).then(function (j) {
            liste.innerHTML = '';
            if (!j.messages.length) { liste.appendChild(el('p', { class: 'petit' }, ['Aucun message pour le moment.'])); return; }
            j.messages.forEach(function (m) {
              liste.appendChild(el('div', { class: 'bandeau ronde-ligne' }, [
                el('div', {}, [el('span', { class: 'ronde-type' }, [m.type]), ' ', el('b', {}, [m.agent]), el('span', { class: 'petit' }, [' · ' + m.horodatage]), el('div', {}, [m.texte])]),
                m.statut === 'Nouveau'
                  ? el('button', { class: 'btn-second', onclick: function () {
                      // texte + heure envoyés : le serveur vérifie que c'est bien ce message avant d'écrire
                      PM.Api.appeler(ctx.apiUrl, { action: 'messageTraite', cle: ctx.cle, ligne: m.ligne, t: m.t, texte: m.texte }).then(chargerListe)['catch'](function (e) { PM.toast(e.message, 5000); chargerListe(); });
                    } }, ['Marquer traité'])
                  : el('span', { class: 'petit' }, ['Traité'])
              ]));
            });
          })['catch'](function () { liste.innerHTML = ''; liste.appendChild(el('p', { class: 'petit' }, ['Historique indisponible hors ligne.'])); });
        }
        chargerListe();
      }
    }
  };
})();
