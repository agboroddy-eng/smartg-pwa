# Déployer SmartG avec GitHub Pages

## Préparer le dépôt

1. Créez un nouveau dépôt GitHub. Avec GitHub Free, utilisez un dépôt public pour le site Pages.
2. Décompressez cette archive sur votre ordinateur.
3. Envoyez **le contenu** de l’archive dans le dépôt, et non le fichier ZIP lui-même. `index.html` doit être directement à la racine du dépôt.
4. Conservez les dossiers `icons/` et les fichiers `app.js`, `manifest.json`, `service-worker.js`, `favicon.png` et `touch-icon-smartg.png`.

## Activer GitHub Pages

Dans le dépôt : **Settings → Pages**.

Dans **Build and deployment**, sélectionnez **Deploy from a branch**, puis choisissez la branche `main` et le dossier `/(root)`, enfin cliquez sur **Save**.

GitHub Pages publie les fichiers statiques poussés dans la branche sélectionnée. La présence de `.nojekyll` dans cette archive évite que Jekyll tente de traiter l’application comme un site Jekyll.

Après quelques minutes, GitHub affichera l’adresse du site dans la section Pages. Pour un dépôt de projet, l’adresse est généralement de la forme `https://VOTRE-NOM.github.io/NOM-DU-DEPOT/`.

## Tester la PWA

Ouvrez l’adresse en HTTPS depuis un smartphone. Créez un mot de passe de test, puis ajoutez quelques comptes et mouvements fictifs. Le service worker doit ensuite permettre le chargement de l’application avec une connexion limitée ou coupée.

Les données SmartG sont locales au navigateur et chiffrées par le mot de passe. Ne saisissez pas de données financières réelles pendant la phase de démonstration.

## Important

Le site publié par GitHub Pages est public. Ne placez jamais dans le dépôt des sauvegardes personnelles, des mots de passe, des secrets ou des données financières réelles.

## Source officielle

https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
