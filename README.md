# Focus To-Do | AI-Powered Productivity Engine

A high-performance, minimalist productivity application combining a deep-focus Pomodoro timer with AI-driven task management. Built with React, TypeScript, Tailwind CSS, and Firebase.

![Focus To-Do](https://picsum.photos/seed/focus/1200/600)

## 🚀 Features

- **🧠 AI Task Breakdown**: Uses Google Gemini to break complex tasks into actionable sub-tasks.
- **🎯 Dynamic Daily Goals**: Set your target focus hours and track progress in real-time.
- **📱 PWA Ready**: Install as a native app on iOS and Android.
- **🎨 Immersive Themes**: Forest, Ocean, Cyberpunk, and Sunset modes with matching ambient sounds.
- **📊 Detailed Analytics**: Track your focus trends and task completion rates.
- **☁️ Firebase Sync**: Real-time synchronization across all your devices.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS
- **Animations**: Framer Motion
- **Database/Auth**: Firebase (Firestore & Auth)
- **AI**: Google Gemini API (@google/genai)
- **Icons**: Lucide React

## 📦 Setup & Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ImmanuelC0D5S/Focus_to_do.git
   cd Focus_to_do
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Variables**:
   Create a `.env` file in the root and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Firebase Configuration**:
   Create a `src/firebase-applet-config.json` with your Firebase project credentials.

5. **Run Development Server**:
   ```bash
   npm run dev
   ```

## 📱 Mobile Installation

This app is a Progressive Web App (PWA).
- **iOS**: Open in Safari -> Share -> Add to Home Screen.
- **Android**: Open in Chrome -> Menu -> Install App.

## 📄 License

MIT
