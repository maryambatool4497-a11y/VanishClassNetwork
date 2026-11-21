# Vanish Class Network

**A real-time messaging application with automatically disappearing messages.**

Vanish Class Network is a React Native mobile application developed using Expo and TypeScript. It allows connected users to exchange messages through a WebSocket relay. Messages automatically expire after 30 seconds.

## 1. Project Overview

The application provides a temporary messaging environment for classroom communication.

### Main Features

- **Real-Time Messaging:** Send and receive messages through a WebSocket connection.
- **30-Second Message Expiry:** Messages automatically expire after their original 30-second lifetime.
- **Message Status:** Supports message lifecycle states such as created, waiting, sent, delivered, displayed, expired, and dropped.
- **Offline Message Queue:** Temporarily queues messages while offline and sends them only if their original expiry deadline has not passed.
- **Presence System:** Displays the number and names of currently connected members.
- **Automatic Reconnection:** Attempts to reconnect when the connection is interrupted.
- **Duplicate Prevention:** Tracks message IDs to prevent duplicate processing.
- **Persistent Display Name:** Saves the user's chosen display name.
- **Teal-Themed Interface:** Includes a branded splash screen, Join Screen, and chat interface.

## 2. Technologies Used

| Technology              | Purpose                             |
| ----------------------- | ----------------------------------- |
| React Native            | Mobile application development      |
| Expo                    | Development and Android builds      |
| TypeScript              | Application programming             |
| WebSocket               | Real-time communication             |
| AsyncStorage            | Local data persistence              |
| React Native Reanimated | Splash screen animation             |
| Git and GitHub          | Version control and project hosting |
| EAS Build               | Android APK generation              |

## 3. Relay Server

The application communicates with the class-approved WebSocket relay.

**Relay Address:**

`wss://vanish-relay-sawaira.bonto.page/ws`

**Protocol Version:** 1

The relay handles message distribution, delivery notifications, expiration, and connected-member presence.

The application follows the class-approved communication protocol.

## 4. Installation and Setup

### Requirements

- Node.js and npm
- Android phone or emulator
- Expo development environment

### Step 1: Clone the Repository

```bash
git clone https://github.com/maryambatool4497-a11y/VanishClassNetwork.git
```

### Step 2: Open the Project

```bash
cd VanishClassNetwork
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Start the Application

```bash
npx expo start
```

Scan the QR code using Expo Go if the project configuration and installed dependencies support it.

## 5. TypeScript Check

To check the project for TypeScript errors, run:

```bash
npx tsc --noEmit
```

## 6. Android APK Build

The Android application can be built using Expo Application Services (EAS).

```bash
npx eas-cli build --platform android --profile preview
```

After the build completes, download the generated APK from the Expo build page and install it on an Android device.

## 7. Message Expiration and Offline Handling

Each message has an original 30-second expiration deadline.

- Messages are removed after expiration.
- The application uses relay server time information to calculate the remaining lifetime.
- Messages queued while offline are sent only if they remain within their original expiration deadline.
- Messages that expire before reconnection are dropped instead of being sent late.

## 8. Project Structure

```text
VanishClassNetwork/
│
├── src/
│   ├── app/
│   │   ├── _layout.tsx
│   │   └── index.tsx
│   │
│   └── components/
│       ├── animated-icon.tsx
│       └── app-tabs.tsx
│
├── assets/
├── constants/
├── package.json
├── app.json
├── eas.json
└── README.md
```

_Note: Other project files and folders may also be present._

## 9. Testing

The application was tested on Android devices.

Testing includes:

- Application launch and splash screen.
- User joining with a display name.
- Real-time message sending and receiving.
- Connected-member presence.
- Automatic message expiration.
- Offline message handling and reconnection.

## 10. Development Tools and AI Assistance

The following tools were used during development:

- **Visual Studio Code:** Code editing and project development.
- **Git and GitHub:** Source-code management and version control.
- **Expo and EAS:** Application development, testing, and Android builds.
- **OpenAI ChatGPT:** Assisted with code explanations, debugging, implementation guidance, and documentation preparation.

AI assistance was used as a development aid. The application was tested by the developer.

## 11. Repository

GitHub Repository:

https://github.com/maryambatool4497-a11y/VanishClassNetwork

---

**Project:** Vanish Class Network  
**Platform:** Android  
**Development Framework:** React Native with Expo  
**Protocol:** WebSocket Protocol Version 1
