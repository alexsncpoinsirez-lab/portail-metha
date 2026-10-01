/* =====================================================================
   MODULE « RONDES JOURNALIÈRES » — version rapide
   - les points de contrôle sont gardés sur le téléphone -> affichage immédiat
   - la ronde en cours est sauvegardée en continu (rien n'est perdu si on ferme)
   - chaque zone validée part dans la file d'envoi (fonctionne sans réseau)
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;

  /* Points de démonstration : utilisés tant que l'URL du serveur n'est pas renseignée */
  var DEMO = {
    nomSite: 'Métha de la Rotte (démo)',
    derniereRonde: { date: '01/10/2026 09:11', agent: 'Mathieu', duree: 272 },
    agents: ['Mathieu', 'Charles', 'Thibaut'],
    points: [
      { zone: 'Supervision', libelle: 'Contrôle courbe production J-1', reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photo: '' },
      { zone: 'Supervision', libelle: 'Contrôle température cylindre A et B (pas de pic haut ou bas après un zoom des courbes)', reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photo: '' },
      { zone: 'Supervision', libelle: 'Contrôle des alarmes', reponses: ['Absence de défaut', 'Présence de défaut réparation effectuée', 'Présence de défaut réparation différée'], reponsesAlerte: ['Présence de défaut réparation effectuée', 'Présence de défaut réparation différée'], photo: '' },
      { zone: 'Supervision', libelle: 'Contrôle T° cuves (45°)', reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photo: '' },
      { zone: 'Supervision', libelle: 'Contrôle valeurs gaz avant charbon (CH4 50-54%) (O2 0,6%) (H2S réagir au-dessus de 250 ppm)', reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photo: '' },
      { zone: 'Incorporation', libelle: 'Contrôle usure vis verticale', reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photo: '' },
      { zone: 'Incorporation', libelle: 'Chargement', reponses: ['Effectué', 'Reporté'], reponsesAlerte: ['Reporté'], photo: '' },
      { zone: 'Incorporation', libelle: 'Nettoyage des fonds poussant', reponses: ['Effectué', 'Reporté'], reponsesAlerte: ['Reporté'], photo: '' },
      { zone: 'Incorporation', libelle: 'Contrôle propreté cible + position capteur', reponses: ['Propre', 'À nettoyer'], reponsesAlerte: ['À nettoyer'], photo: '' },
      { zone: 'Salle des pompes', libelle: 'Pression/Niveau pompe lobes', reponses: ['Conforme', 'Appoint d\'huile'], reponsesAlerte: ['Appoint d\'huile'], photo: '' },
      { zone: 'Salle des pompes', libelle: 'Contrôle niveau Wangen recirculation', reponses: ['Conforme', 'Appoint d\'huile'], reponsesAlerte: ['Appoint d\'huile'], photo: '' },
      { zone: 'Premix', libelle: 'Lavage zone prémix', reponses: ['Effectué', 'Reporté'], reponsesAlerte: ['Reporté'], photo: '' }
    ]
  };

  function cleDuPoint(p) { return p.zone + ' || ' + p.libelle; }
  function maintenantIso() { return new Date().toISOString(); }

  /* Réduit une photo avant envoi (1280 px, JPEG) : ~200 Ko au lieu de 4 Mo */
  function compresserPhoto(fichier) {
    return new Promise(function (ok, ko) {
      var lecteur = new FileReader();
      lecteur.onerror = ko;
      lecteur.onload = function () {
        var img = new Image();
        img.onerror = ko;
        img.onload = function () {
          var max = 1280, w = img.width, h = img.height, r = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * r); c.height = Math.round(h * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', 0.72));
        };
        img.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }

  function visionneuse(src) {
    var v = el('div', { class: 'visionneuse', onclick: function () { v.remove(); } }, [el('img', { src: src, alt: '' })]);
    document.body.appendChild(v);
  }

  window.MODULES.rondes = {
    afficher: function (vue, ctx) {
      var outilId = ctx.outil.id;
      var modeDemo = !ctx.apiUrl;
      var CLE_CFG = 'rondes_cfg_' + outilId;
      var CLE_BROUILLON = 'rondes_brouillon_' + outilId;
      var config = null;      // points de contrôle
      var brouillon = null;   // ronde en cours
      var zoneActive = null;

      /* ---------- Démarrage : affichage immédiat depuis le téléphone ---------- */
      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));

      Promise.all([PM.DB.get(CLE_CFG), PM.DB.get(CLE_BROUILLON)]).then(function (r) {
        config = r[0] || (modeDemo ? DEMO : null);
        brouillon = r[1] || null;
        if (config) afficherTout();
        if (!modeDemo) rafraichirDepuisServeur(!config);
      });

      function rafraichirDepuisServeur(premierChargement) {
        PM.Api.appeler(ctx.apiUrl, { action: 'config', cle: ctx.cle }, 25000).then(function (j) {
          var neuf = { nomSite: j.nomSite, points: j.points, derniereRonde: j.derniereRonde, agents: j.agents || [] };
          var change = JSON.stringify(neuf) !== JSON.stringify(config);
          config = neuf;
          PM.DB.set(CLE_CFG, neuf);
          if (change) afficherTout();
        })['catch'](function (e) {
          if (premierChargement) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, [
              'Impossible de charger les points de contrôle.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])
            ]));
          } else {
            PM.toast('Hors ligne : points de contrôle du dernier chargement');
          }
        });
      }

      function sauverBrouillon() { return PM.DB.set(CLE_BROUILLON, brouillon); }

      function zones() {
        var ordre = [];
        config.points.forEach(function (p) { if (ordre.indexOf(p.zone) < 0) ordre.push(p.zone); });
        return ordre;
      }

      /* ---------- Choix de l'agent ---------- */
      function ecranAgent() {
        vue.innerHTML = '';
        var saisie = el('input', { type: 'text', placeholder: 'Ton prénom', value: '' });
        var valider = function (nom) {
          nom = (nom || '').trim();
          if (!nom) { PM.toast('Indique ton prénom'); return; }
          PM.Prefs.set('agent', nom);
          afficherTout();
        };
        var boutons = el('div', { class: 'agents' });
        (config.agents || []).forEach(function (a) {
          boutons.appendChild(el('button', { class: 'btn-second', onclick: function () { valider(a); } }, [a]));
        });
        vue.appendChild(el('div', { class: 'bandeau' }, [
          el('div', { style: 'font-weight:700;font-size:18px' }, ['Qui fait la ronde ?']),
          el('div', { class: 'petit' }, ['Retenu sur ce téléphone, modifiable ensuite.']),
          boutons,
          el('div', { class: 'champ' }, [saisie]),
          el('button', { class: 'btn-principal', onclick: function () { valider(saisie.value); } }, ['Continuer'])
        ]));
      }

      /* ---------- Écran principal ---------- */
      function afficherTout(hautDePage) {
        var y = window.scrollY;
        var agent = PM.Prefs.get('agent', '');
        if (!agent) { ecranAgent(); return; }
        if (!brouillon) {
          brouillon = { rondeId: PM.uid(), agent: agent, debut: maintenantIso(), reponses: {}, zonesEnvoyees: {} };
          sauverBrouillon();
        }
        var zs = zones();
        if (!zoneActive || zs.indexOf(zoneActive) < 0) zoneActive = brouillon.zoneActive && zs.indexOf(brouillon.zoneActive) >= 0 ? brouillon.zoneActive : zs[0];

        vue.innerHTML = '';
        if (modeDemo) {
          vue.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']),
            el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne l’URL du serveur dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.'
          ]));
        }

        // Bandeau : agent, dernière ronde, progression
        var total = config.points.length;
        var faits = Object.keys(brouillon.reponses).length;
        var dr = config.derniereRonde;
        var pct = total ? Math.round(faits / total * 100) : 0;
        vue.appendChild(el('div', { class: 'bandeau' }, [
          el('div', { class: 'bandeau-ligne' }, [
            el('div', { class: 'anneau', style: '--p:' + pct }, [el('span', {}, [pct + '%'])]),
            el('div', { style: 'flex:1;min-width:0' }, [
              el('div', { style: 'font-weight:700' }, ['Agent : ' + brouillon.agent]),
              el('div', { class: 'petit' }, [dr ? 'Dernière ronde : ' + dr.date + ' · ' + dr.agent + (dr.duree ? ' · ' + dr.duree + ' min' : '') : 'Aucune ronde enregistrée'])
            ]),
            el('button', { class: 'btn-second', onclick: function () {
              if (faits && !confirm('Changer d’agent ? La ronde en cours reste enregistrée.')) return;
              PM.Prefs.set('agent', ''); brouillon.agent = ''; ecranAgent();
            } }, ['Changer'])
          ]),
          el('div', { class: 'progression' }, [el('div', { style: 'width:' + pct + '%' })]),
          el('div', { class: 'petit', style: 'margin-top:6px' }, [faits + ' / ' + total + ' points contrôlés'])
        ]));

        // Onglets des zones
        var barreZones = el('div', { class: 'zones' });
        zs.forEach(function (z) {
          var pts = config.points.filter(function (p) { return p.zone === z; });
          var n = pts.filter(function (p) { return brouillon.reponses[cleDuPoint(p)]; }).length;
          barreZones.appendChild(el('button', {
            class: 'zone-chip' + (z === zoneActive ? ' actif' : '') + (n === pts.length ? ' complet' : ''),
            onclick: function () { zoneActive = z; brouillon.zoneActive = z; sauverBrouillon(); afficherTout(true); }
          }, [z, el('span', { class: 'cpt' }, [n + '/' + pts.length])]));
        });
        vue.appendChild(barreZones);

        // Points de la zone active
        config.points.filter(function (p) { return p.zone === zoneActive; }).forEach(function (p) {
          vue.appendChild(cartePoint(p));
        });

        // Boutons du bas
        var idx = zs.indexOf(zoneActive);
        var suivante = zs[idx + 1];
        var pied = el('div', { class: 'pied-fixe' }, [el('div', { style: 'display:flex;gap:8px' }, [
          suivante
            ? el('button', { class: 'btn-principal', onclick: function () { validerZone(zoneActive); zoneActive = suivante; brouillon.zoneActive = suivante; sauverBrouillon(); afficherTout(true); } }, ['Zone suivante : ' + suivante + ' →'])
            : el('button', { class: 'btn-principal', onclick: terminerRonde }, ['Terminer la ronde ✓'])
        ])]);
        vue.appendChild(pied);
        window.scrollTo(0, hautDePage ? 0 : y);
      }

      function cartePoint(p) {
        var cle = cleDuPoint(p);
        var rep = brouillon.reponses[cle];
        var envoye = rep && rep.envoye;
        var carte = el('div', { class: 'point' + (rep ? ' fait' : '') + (rep && rep.alerte ? ' en-alerte' : '') });

        var tete = el('div', { class: 'point-tete' }, [el('div', { class: 'point-libelle' }, [p.libelle])]);
        if (p.photo && p.photo.indexOf('ID_DU_FICHIER') < 0) {
          tete.appendChild(el('button', { class: 'point-ref', 'aria-label': 'Photo de référence', onclick: function () { visionneuse(p.photo); } }, [
            el('img', { src: p.photo, loading: 'lazy', alt: '', onerror: function () { this.parentNode.remove(); } })
          ]));
        }
        carte.appendChild(tete);

        var grille = el('div', { class: 'reponses' });
        p.reponses.forEach(function (r) {
          var estAlerte = p.reponsesAlerte.indexOf(r) >= 0;
          grille.appendChild(el('button', {
            class: 'rep' + (rep && rep.reponse === r ? ' choisi' : '') + (estAlerte ? ' alerte' : ''),
            disabled: envoye ? 'disabled' : null,
            onclick: function () {
              var ancien = brouillon.reponses[cle] || {};
              brouillon.reponses[cle] = {
                zone: p.zone, libelle: p.libelle, reponse: r, alerte: estAlerte,
                commentaire: ancien.commentaire || '', photo: ancien.photo || null, horodatage: maintenantIso()
              };
              sauverBrouillon();
              afficherTout();
              if (estAlerte) PM.toast('Réponse d’alerte : ajoute un commentaire ou une photo si besoin');
            }
          }, [r]));
        });
        carte.appendChild(grille);

        // Commentaire + photo (dès qu'une réponse est choisie)
        if (rep) {
          var extras = el('div', { class: 'extras' });
          if (rep.alerte || rep.commentaire) {
            var ta = el('textarea', { placeholder: 'Commentaire (détail, valeur relevée…)', disabled: envoye ? 'disabled' : null });
            ta.value = rep.commentaire || '';
            ta.addEventListener('input', function () { rep.commentaire = ta.value; sauverBrouillon(); });
            extras.appendChild(ta);
          } else if (!envoye) {
            extras.appendChild(el('button', { class: 'btn-photo', onclick: function () { rep.commentaire = ' '; afficherTout(); } }, ['+ Commentaire']));
          }
          if (!envoye) {
            var input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
            input.addEventListener('change', function () {
              if (!input.files[0]) return;
              PM.toast('Préparation de la photo…', 1200);
              compresserPhoto(input.files[0]).then(function (d) { rep.photo = d; sauverBrouillon(); afficherTout(); })
                ['catch'](function () { PM.toast('Photo illisible'); });
            });
            extras.appendChild(input);
            extras.appendChild(el('button', { class: 'btn-photo', onclick: function () { input.click(); } }, [rep.photo ? '📷 Remplacer' : '📷 Photo']));
          }
          if (rep.photo) extras.appendChild(el('img', { class: 'vignette', src: rep.photo, alt: 'Photo', onclick: function () { visionneuse(rep.photo); } }));
          extras.appendChild(el('span', { class: 'statut-envoi' }, [envoye ? '✓ Validé' : 'Non validé']));
          carte.appendChild(extras);
        }
        return carte;
      }

      /* Une zone validée : ses réponses partent dans la file d'envoi */
      function validerZone(z) {
        var aEnvoyer = Object.keys(brouillon.reponses).filter(function (k) {
          var r = brouillon.reponses[k]; return r.zone === z && !r.envoye;
        });
        aEnvoyer.forEach(function (k) {
          var r = brouillon.reponses[k];
          r.envoye = true;
          if (modeDemo) return;
          PM.Envoi.ajouter(ctx.site.id, {
            type: 'reponse', rondeId: brouillon.rondeId, agent: brouillon.agent,
            horodatage: r.horodatage, zone: r.zone, libelle: r.libelle, reponse: r.reponse,
            alerte: r.alerte, commentaire: (r.commentaire || '').trim(), photo: r.photo || null
          }, !!r.photo);
        });
        sauverBrouillon();
        return aEnvoyer.length;
      }

      function terminerRonde() {
        var total = config.points.length;
        var faits = Object.keys(brouillon.reponses).length;
        if (faits < total && !confirm((total - faits) + ' point(s) sans réponse. Terminer quand même ?')) return;
        zones().forEach(validerZone);
        var fin = maintenantIso();
        if (!modeDemo) {
          PM.Envoi.ajouter(ctx.site.id, {
            type: 'finRonde', rondeId: brouillon.rondeId, agent: brouillon.agent, debut: brouillon.debut, fin: fin
          });
        }
        var alertes = Object.keys(brouillon.reponses).filter(function (k) { return brouillon.reponses[k].alerte; }).length;
        var duree = Math.round((new Date(fin) - new Date(brouillon.debut)) / 60000);
        brouillon = null;
        PM.DB.del(CLE_BROUILLON);

        vue.innerHTML = '';
        var statut = el('div', { class: 'petit' }, ['']);
        vue.appendChild(el('div', { class: 'bandeau', style: 'text-align:center;padding:28px 16px' }, [
          el('div', { style: 'font-size:44px' }, ['✓']),
          el('div', { style: 'font-size:22px;font-weight:800' }, ['Ronde terminée']),
          el('p', {}, [faits + ' points contrôlés · ' + alertes + ' réponse(s) d’alerte · ' + duree + ' min']),
          statut,
          el('div', { style: 'height:12px' }),
          el('button', { class: 'btn-principal', onclick: function () { location.hash = 'site/' + ctx.site.id; } }, ['Retour aux outils'])
        ]));
        function majStatut(n) {
          statut.textContent = modeDemo ? 'Mode démo : rien n’a été envoyé.'
            : (n ? (navigator.onLine ? 'Envoi en cours… (' + n + ' restant)' : 'Pas de réseau : envoi automatique dès le retour du réseau (' + n + ' en attente).')
                 : 'Tout est enregistré dans la feuille Google ✓');
        }
        PM.Envoi.surChangement(majStatut);
        PM.Envoi.compter().then(majStatut);
      }
    }
  };
})();
