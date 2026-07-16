# Spare-Parts Portal: Deployment & Domain Guide

This full-stack application consists of two parts:
1. **Frontend**: Vite React App (runs in the user's browser, communicates with Firebase and the backend API).
2. **Backend**: Express Server (`server.js`, handles file uploads, parsing, Excel processing, and optional database integrations).

Since **GitHub Pages** is a static hosting platform, it **cannot** run Node.js backend servers (like `server.js`). To publish the portal with a custom domain, you should:
- Deploy the **Frontend** to GitHub Pages (free, supports custom domains).
- Deploy the **Backend** to Render or Railway (free/low-cost Node.js hosting).

---

## Part 1: Deploy the Backend on Render (Free Tier)
Render is a popular platform for hosting Node.js applications.

1. **Sign Up**: Go to [Render](https://render.com/) and create a free account.
2. **Create Web Service**: Click **New +** and select **Web Service**.
3. **Connect Repository**: Connect your GitHub repository containing this codebase.
4. **Configure Settings**:
   - **Name**: `spare-parts-backend` (or any name)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
5. **Environment Variables**: Under the **Environment** tab, add your environment variables:
   - `PORT`: `3000`
   - Add any other secrets from your local `.env` file (e.g. Firebase config keys, Gemini API keys).
6. **Deploy**: Render will build and deploy your backend. It will provide a URL like `https://spare-parts-backend.onrender.com`.

---

## Part 2: Deploy the Frontend on GitHub Pages
Now, you will build and publish your Vite React frontend to GitHub Pages, configured to point to your new Render backend URL.

### 1. Configure the Build Settings
Open `vite.config.ts` or add a build command that passes the backend URL. You can specify the API URL at build time.

### 2. Configure GitHub Pages Deployment
The easiest way is to use the `gh-pages` npm package:

1. **Install the package** in the project directory:
   ```bash
   npm install gh-pages --save-dev
   ```

2. **Update `package.json`**:
   Add the following scripts to the `"scripts"` block in your [package.json](file:///c:/Users/ASUS/Downloads/Spare-Parts-Portal%20Updating/package.json):
   ```json
   "predeploy": "npm run build",
   "deploy": "gh-pages -d dist"
   ```
   Also add a `"homepage"` field at the root level of `package.json`:
   ```json
   "homepage": "https://<your-username>.github.io/<repository-name>"
   ```

3. **Set the Backend API Environment Variable**:
   Create a file named `.env.production` in the root folder and add:
   ```env
   VITE_API_URL=https://spare-parts-backend.onrender.com
   ```
   *(Vite will automatically load variables starting with `VITE_` from `.env.production` during `npm run build`).*

4. **Deploy to GitHub Pages**:
   Run the deployment command:
   ```bash
   npm run deploy
   ```
   This will build the app and push the generated `dist` folder to a new `gh-pages` branch on GitHub.

5. **Enable GitHub Pages**:
   - Go to your GitHub repository.
   - Click **Settings** > **Pages**.
   - Under **Build and deployment**, ensure the source is set to **Deploy from a branch** and select the `gh-pages` branch.

---

## Part 3: Assign a Custom/Suitable Domain
To use your own custom domain (e.g., `portal.yourcompany.com`) instead of `<username>.github.io`:

1. **Buy a Domain**: Purchase a domain from a domain registrar (GoDaddy, Namecheap, Cloudflare, etc.).
2. **Add Custom Domain on GitHub**:
   - In your GitHub Repository, go to **Settings** > **Pages**.
   - Under **Custom domain**, type your domain name (e.g., `portal.yourcompany.com`) and click **Save**.
3. **Configure DNS Records (with your Registrar)**:
   Add the following records to your domain's DNS management settings:
   
   *For an Apex Domain (e.g., `yourcompany.com`)*:
   Create **A Records** pointing to GitHub Pages IP addresses:
   - `185.199.108.153`
   - `185.199.109.153`
   - `185.199.110.153`
   - `185.199.111.153`

   *For a Subdomain (e.g., `portal.yourcompany.com`)*:
   Create a **CNAME Record**:
   - **Name/Host**: `portal`
   - **Value/Target**: `<your-username>.github.io`
4. **HTTPS Verification**: Once DNS propagates (takes 5-30 minutes), check the **Enforce HTTPS** box in GitHub Repository Settings under Pages.
