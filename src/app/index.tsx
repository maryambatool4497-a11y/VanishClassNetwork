import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type Message = {
  id: string;
  text: string;
  expiresAt: number;
  createdAt: number;
  status: "waiting" | "sent" | "expired";
  sender?: string;
  isMine?: boolean;
};

const STORAGE_KEY = "vanish_messages";
const RELAY_URL = "wss://vanish-relay-sawaira.bonto.page/ws";
const NAME_STORAGE_KEY = "vanish_display_name";
const DEVICE_ID_KEY = "vanish_device_id";
const PROTOCOL_VERSION = 1;

export default function HomeScreen() {
  const [deviceId, setDeviceId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageQueue, setMessageQueue] = useState<Message[]>([]);
  const [relayStatus, setRelayStatus] = useState("Disconnected");
  const [reconnectKey, setReconnectKey] = useState(0);
  const [connectedMembers, setConnectedMembers] = useState<string[]>([]);
  const [memberCount, setMemberCount] = useState(0);

  const [displayName, setDisplayName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [isNameLoaded, setIsNameLoaded] = useState(false);
  const [nameError, setNameError] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serverTimeOffsetRef = useRef(0);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingMessageIdsRef = useRef<Set<string>>(new Set());

  const lastPongAtRef = useRef(Date.now());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [input, setInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(false);

  // Load the saved display name
  useEffect(() => {
    const loadSavedName = async () => {
      try {
        const savedName = await AsyncStorage.getItem(NAME_STORAGE_KEY);

        if (
          savedName &&
          savedName.trim().length > 0 &&
          savedName.trim().length <= 30
        ) {
          setDisplayName(savedName.trim());
          setNameInput(savedName.trim());
          setHasJoined(true);
        }
      } catch (error) {
        console.log("Error loading display name:", error);
      } finally {
        setIsNameLoaded(true);
      }
    };

    loadSavedName();
  }, []);

  // Join chat and permanently save the display name
  const joinChat = async () => {
    const cleanName = nameInput.trim();

    if (cleanName.length === 0) {
      setNameError("Please enter your name.");
      return;
    }

    if (cleanName.length > 30) {
      setNameError("Name cannot exceed 30 characters.");
      return;
    }

    try {
      await AsyncStorage.setItem(NAME_STORAGE_KEY, cleanName);

      setDisplayName(cleanName);
      setNameInput(cleanName);
      setNameError("");
      setHasJoined(true);
    } catch (error) {
      console.log("Error saving display name:", error);
      setNameError("Could not save your name. Please try again.");
    }
  };

  // Load or create a permanent device ID
  useEffect(() => {
    const loadDeviceId = async () => {
      try {
        let savedId = await AsyncStorage.getItem(DEVICE_ID_KEY);

        if (!savedId) {
          savedId = `device_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 10)}`;

          await AsyncStorage.setItem(DEVICE_ID_KEY, savedId);
        }

        setDeviceId(savedId);
      } catch (error) {
        console.log("Device ID error:", error);
      }
    };

    loadDeviceId();
  }, []);

  // Connect to the class relay only after the user has joined
  useEffect(() => {
    if (!deviceId || !isNameLoaded || !hasJoined || !displayName) return;

    if (!isOnline) {
      setConnectedMembers([]);
      setMemberCount(0);
      setRelayStatus("Offline");
      return;
    }

    let active = true;

    setRelayStatus("Connecting...");
    console.log("Attempting relay connection...");

    const socket = new WebSocket(RELAY_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      if (!active) return;

      socket.send(
        JSON.stringify({
          type: "join",
          protocol: PROTOCOL_VERSION,
          device_id: deviceId,
          name: displayName,
        }),
      );

      setRelayStatus("Joining...");
      lastPongAtRef.current = Date.now();

      heartbeatRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);

      watchdogRef.current = setInterval(() => {
        if (Date.now() - lastPongAtRef.current >= 30000) {
          socket.close();
        }
      }, 1000);
    };

    socket.onmessage = (event) => {
      if (!active) return;

      try {
        const data = JSON.parse(event.data);

        if (data.type === "welcome" && typeof data.server_time === "number") {
          reconnectAttemptRef.current = 0;
          serverTimeOffsetRef.current = data.server_time - Date.now();
          setRelayStatus("Connected");
          console.log("Joined relay successfully!");
        } else if (data.type === "error") {
          setRelayStatus("Relay error");
          console.log("Relay error:", data);
        } else if (data.type === "pong") {
          lastPongAtRef.current = Date.now();
        } else if (
          data.type === "presence" &&
          typeof data.count === "number" &&
          Array.isArray(data.members) &&
          data.members.every((member: unknown) => typeof member === "string")
        ) {
          setMemberCount(data.count);
          setConnectedMembers(data.members);
          console.log("Connected members:", data.members);
        } else if (data.type === "delivered" && typeof data.id === "string") {
          pendingMessageIdsRef.current.delete(data.id);

          setMessages((previousMessages) =>
            previousMessages.map((message) =>
              message.id === data.id ? { ...message, status: "sent" } : message,
            ),
          );
        } else if (
          data.type === "message" &&
          typeof data.id === "string" &&
          typeof data.text === "string" &&
          typeof data.sender === "string" &&
          typeof data.expires_at === "number" &&
          typeof data.sent_at === "number"
        ) {
          if (seenMessageIdsRef.current.has(data.id)) return;

          seenMessageIdsRef.current.add(data.id);

          const localExpiry = data.expires_at - serverTimeOffsetRef.current;
          const localSentTime = data.sent_at - serverTimeOffsetRef.current;

          if (localExpiry <= Date.now()) return;

          const incomingMessage: Message = {
            id: data.id,
            text: data.text,
            sender: data.sender,
            createdAt: localSentTime,
            expiresAt: localExpiry,
            status: "sent",
            isMine: data.sender === displayName,
          };

          setMessages((previousMessages) => {
            if (
              previousMessages.some(
                (message) => message.id === incomingMessage.id,
              )
            ) {
              return previousMessages;
            }

            return [...previousMessages, incomingMessage];
          });

          console.log("Received message:", data.id);
        } else if (data.type === "expired" && typeof data.id === "string") {
          pendingMessageIdsRef.current.delete(data.id);

          setMessages((previousMessages) =>
            previousMessages.filter((message) => message.id !== data.id),
          );

          setMessageQueue((previousQueue) =>
            previousQueue.filter((message) => message.id !== data.id),
          );
        }
      } catch (error) {
        console.log("Invalid relay response:", error);
      }
    };

    socket.onerror = () => {
      if (active) setRelayStatus("Connection error");
    };

    socket.onclose = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }

      if (active) {
        setConnectedMembers([]);
        setMemberCount(0);
        setRelayStatus("Disconnected");

        if (isOnline) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 8000);
          reconnectAttemptRef.current += 1;

          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            setReconnectKey((previous) => previous + 1);
          }, delay);
        }
      }
    };

    return () => {
      active = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      socket.close();
    };
  }, [deviceId, isNameLoaded, hasJoined, displayName, isOnline, reconnectKey]);

  // Monitor internet connectivity
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(
        state.isConnected === true && state.isInternetReachable !== false,
      );
    });

    return unsubscribe;
  }, []);

  // Load saved messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const savedMessages = await AsyncStorage.getItem(STORAGE_KEY);

        if (savedMessages !== null) {
          const parsedMessages: Message[] = JSON.parse(savedMessages);
          const currentTime = Date.now();

          const validMessages = parsedMessages.filter(
            (message) => message.expiresAt > currentTime,
          );

          setMessages(validMessages);
          setMessageQueue(
            validMessages.filter((message) => message.status === "waiting"),
          );

          validMessages.forEach((message) => {
            seenMessageIdsRef.current.add(message.id);
          });
        }
      } catch (error) {
        console.log("Error loading messages:", error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadMessages();
  }, []);

  // Save messages whenever they change
  useEffect(() => {
    if (!isLoaded) return;

    const saveMessages = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      } catch (error) {
        console.log("Error saving messages:", error);
      }
    };

    saveMessages();
  }, [messages, isLoaded]);

  // Update countdown and remove expired messages
  useEffect(() => {
    if (!isLoaded) return;

    const updateMessages = () => {
      const currentTime = Date.now();
      setNow(currentTime);

      setMessages((previousMessages) =>
        previousMessages.filter((message) => message.expiresAt > currentTime),
      );

      setMessageQueue((previousQueue) =>
        previousQueue.filter((message) => message.expiresAt > currentTime),
      );
    };

    const timer = setInterval(updateMessages, 250);

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updateMessages();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [isLoaded]);

  // Send queued messages when connected
  useEffect(() => {
    if (
      !hasJoined ||
      !displayName ||
      !isLoaded ||
      !isOnline ||
      relayStatus !== "Connected"
    ) {
      return;
    }

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const currentTime = Date.now();

    const hasExpiredMessages = messageQueue.some(
      (message) => message.expiresAt <= currentTime,
    );

    if (hasExpiredMessages) {
      setMessageQueue((previousQueue) =>
        previousQueue.filter((message) => message.expiresAt > Date.now()),
      );
    }

    const validMessages = messageQueue.filter(
      (message) => message.expiresAt > currentTime,
    );

    validMessages.forEach((message) => {
      if (pendingMessageIdsRef.current.has(message.id)) return;
      if (message.expiresAt <= Date.now()) return;

      try {
        pendingMessageIdsRef.current.add(message.id);

        socket.send(
          JSON.stringify({
            type: "message",
            id: message.id,
            sender: displayName,
            text: message.text,
          }),
        );

        console.log("Message submitted to relay:", message.id);

        setMessageQueue((previousQueue) =>
          previousQueue.filter((item) => item.id !== message.id),
        );
      } catch (error) {
        pendingMessageIdsRef.current.delete(message.id);
        console.log("Message sending failed:", error);
      }
    });
  }, [messageQueue, isLoaded, isOnline, relayStatus, hasJoined, displayName]);

  // Send message
  const sendMessage = () => {
    const cleanText = input.trim();

    if (cleanText === "") return;

    if (cleanText.length > 500) {
      console.log("Message cannot exceed 500 characters.");
      return;
    }

    const currentTime = Date.now();

    const newMessage: Message = {
      id: `${currentTime}-${Math.random()}`,
      text: cleanText,
      createdAt: currentTime,
      expiresAt: currentTime + 30000,
      status: "waiting",
      sender: displayName,
      isMine: true,
    };

    seenMessageIdsRef.current.add(newMessage.id);
    setMessages((previousMessages) => [...previousMessages, newMessage]);
    setMessageQueue((previousQueue) => [...previousQueue, newMessage]);
    setInput("");
  };

  const getMessageStatus = (message: Message) => {
    if (message.status === "waiting") return "Waiting for server...";
    if (message.isMine === false) return "Received";
    return "Sent";
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="dark-content" />

      {!isNameLoaded ? (
        <View style={styles.joinScreen}>
          <View style={styles.joinLogoCircle}>
            <Text style={styles.joinLogo}>✿</Text>
          </View>
          <Text style={styles.joinBrand}>Vanish Class</Text>
          <Text style={styles.joinSubtitle}>Loading your chat...</Text>
        </View>
      ) : !hasJoined ? (
        <View style={styles.joinScreen}>
          <View style={styles.joinLogoCircle}>
            <Text style={styles.joinLogo}>✿</Text>
          </View>

          <Text style={styles.joinBrand}>Vanish Class</Text>
          <Text style={styles.joinSubtitle}>
            little chats, lasting moments ♡
          </Text>

          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeTitle}>Welcome!</Text>

            <Text style={styles.welcomeDescription}>
              Join your class chat and share little conversations with your
              classmates.
            </Text>

            <Text style={styles.nameLabel}>YOUR DISPLAY NAME</Text>

            <TextInput
              style={styles.nameInput}
              placeholder="Enter your name..."
              placeholderTextColor="#8CA6A2"
              value={nameInput}
              onChangeText={(value) => {
                setNameInput(value);
                setNameError("");
              }}
              maxLength={30}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={joinChat}
            />

            {nameError !== "" && (
              <Text style={styles.nameError}>{nameError}</Text>
            )}

            <TouchableOpacity
              style={[
                styles.joinButton,
                nameInput.trim() === "" && styles.disabledJoinButton,
              ]}
              onPress={joinChat}
              disabled={nameInput.trim() === ""}
              activeOpacity={0.8}
            >
              <Text style={styles.joinButtonText}>Join Chat</Text>
            </TouchableOpacity>

            <Text style={styles.joinNote}>
              ✨ Every message disappears after 30 seconds
            </Text>
          </View>

          <Text style={styles.joinFooter}>
            Vanish Class • made for your classroom ♡
          </Text>
        </View>
      ) : (
        <>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.logoCircle}>
                <Text style={styles.logo}>✿</Text>
              </View>

              <View style={styles.titleArea}>
                <Text style={styles.headerTitle}>Vanish Class</Text>
                <Text style={styles.headerSubtitle}>
                  little chats, lasting moments ♡
                </Text>
              </View>

              <View style={styles.statusBadge}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isOnline ? "#168F83" : "#D97777" },
                  ]}
                />
                <Text style={styles.statusText}>
                  {isOnline ? "ONLINE" : "OFFLINE"}
                </Text>
              </View>
            </View>

            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                ✨ Every message has a 30-second lifetime
              </Text>
              <Text style={styles.relayText}>Relay: {relayStatus}</Text>
            </View>

            <View style={styles.presenceContainer}>
              <View style={styles.presenceTop}>
                <Text style={styles.presenceTitle}>Connected members</Text>
                <View style={styles.memberCountBadge}>
                  <Text style={styles.memberCountText}>{memberCount}</Text>
                </View>
              </View>

              <Text style={styles.presenceNames}>
                {connectedMembers.length > 0
                  ? connectedMembers.join("  •  ")
                  : "No members connected"}
              </Text>
            </View>
          </View>

          {/* Chat area */}
          <FlatList
            style={styles.chatArea}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Text style={styles.emptyIcon}>💬</Text>
                </View>

                <Text style={styles.emptyTitle}>Your chat starts here</Text>
                <Text style={styles.emptySubtitle}>
                  Send a message and start a conversation{"\n"}
                  with your classmates.
                </Text>
                <Text style={styles.emptyDecoration}>─── ♡ ───</Text>
              </View>
            }
            renderItem={({ item }) => {
              const secondsLeft = Math.max(
                0,
                Math.ceil((item.expiresAt - now) / 1000),
              );

              const messageTime = new Date(item.createdAt).toLocaleTimeString(
                [],
                {
                  hour: "2-digit",
                  minute: "2-digit",
                },
              );

              const isMine = item.isMine !== false;

              return (
                <View
                  style={[
                    styles.messageWrapper,
                    !isMine && styles.receivedMessageWrapper,
                  ]}
                >
                  <Text
                    style={[
                      styles.senderLabel,
                      !isMine && styles.receivedSenderLabel,
                    ]}
                  >
                    {isMine ? "YOU" : item.sender || "CLASSMATE"}
                  </Text>

                  <View
                    style={[
                      styles.messageBubble,
                      !isMine && styles.receivedMessageBubble,
                    ]}
                  >
                    <Text style={styles.messageText}>{item.text}</Text>
                    <Text style={styles.messageStatus}>
                      {getMessageStatus(item)}
                    </Text>

                    <View style={styles.messageFooter}>
                      <Text style={styles.timeText}>{messageTime}</Text>
                      <View style={styles.expiryBadge}>
                        <Text style={styles.expiryText}>◷ {secondsLeft}s</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            }}
          />

          {/* Message input */}
          <View style={styles.inputSection}>
            <Text style={styles.inputHint}>SEND A MESSAGE</Text>

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.textInput}
                placeholder="Write your message..."
                placeholderTextColor="#8CA6A2"
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={500}
                textAlignVertical="center"
                blurOnSubmit={false}
                returnKeyType="default"
              />

              <TouchableOpacity
                style={[
                  styles.sendButton,
                  input.trim() !== "" && styles.activeSendButton,
                ]}
                onPress={sendMessage}
                activeOpacity={0.8}
                disabled={input.trim() === ""}
              >
                <Text style={styles.sendIcon}>➤</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.bottomText}>
              Vanish Class • little conversations, short-lived messages
            </Text>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5FAF9",
  },

  // Join screen
  joinScreen: {
    flex: 1,
    backgroundColor: "#F5FAF9",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 25,
  },

  joinLogoCircle: {
    height: 85,
    width: 85,
    borderRadius: 28,
    backgroundColor: "#DDF3EF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },

  joinLogo: {
    fontSize: 48,
    color: "#168F83",
  },

  joinBrand: {
    fontSize: 29,
    fontWeight: "bold",
    color: "#174F49",
  },

  joinSubtitle: {
    fontSize: 13,
    color: "#72968F",
    marginTop: 7,
  },

  welcomeCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 25,
    padding: 23,
    marginTop: 38,
    borderWidth: 1,
    borderColor: "#DCEDE9",
    elevation: 3,
    shadowColor: "#568B81",
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },

  welcomeTitle: {
    fontSize: 23,
    fontWeight: "bold",
    color: "#245F57",
  },

  welcomeDescription: {
    fontSize: 13,
    lineHeight: 21,
    color: "#789A94",
    marginTop: 9,
    marginBottom: 25,
  },

  nameLabel: {
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 1,
    color: "#568B81",
    marginBottom: 9,
  },

  nameInput: {
    backgroundColor: "#F3F9F7",
    borderWidth: 1,
    borderColor: "#D9EAE6",
    borderRadius: 15,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 14,
    color: "#285B54",
  },

  nameError: {
    color: "#C45F5F",
    fontSize: 12,
    marginTop: 8,
  },

  joinButton: {
    backgroundColor: "#168F83",
    borderRadius: 15,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 18,
  },

  disabledJoinButton: {
    backgroundColor: "#B9DCD5",
  },

  joinButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "bold",
  },

  joinNote: {
    textAlign: "center",
    color: "#83A69F",
    fontSize: 11,
    marginTop: 20,
  },

  joinFooter: {
    color: "#91AAA5",
    fontSize: 11,
    marginTop: 35,
  },

  // Chat header
  header: {
    backgroundColor: "#DDF3EF",
    paddingTop: Platform.OS === "android" ? 42 : 55,
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "center",
  },

  logoCircle: {
    height: 50,
    width: 50,
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },

  logo: {
    fontSize: 29,
    color: "#168F83",
  },

  titleArea: {
    flex: 1,
    marginLeft: 12,
  },

  headerTitle: {
    fontSize: 23,
    fontWeight: "bold",
    color: "#174F49",
  },

  headerSubtitle: {
    fontSize: 12,
    color: "#56847D",
    marginTop: 3,
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },

  statusDot: {
    height: 7,
    width: 7,
    borderRadius: 5,
    marginRight: 5,
  },

  statusText: {
    fontSize: 10,
    color: "#276E65",
    fontWeight: "bold",
  },

  notice: {
    backgroundColor: "#F5FCFA",
    marginTop: 17,
    padding: 11,
    borderRadius: 13,
    alignItems: "center",
  },

  noticeText: {
    color: "#34786F",
    fontSize: 12,
    fontWeight: "600",
  },

  relayText: {
    color: "#6A918B",
    fontSize: 10,
    marginTop: 5,
  },

  presenceContainer: {
    marginTop: 10,
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D4EAE5",
  },

  presenceTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  presenceTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#245F57",
  },

  memberCountBadge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 7,
    borderRadius: 13,
    backgroundColor: "#168F83",
    justifyContent: "center",
    alignItems: "center",
  },

  memberCountText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "bold",
  },

  presenceNames: {
    fontSize: 12,
    color: "#648A84",
    marginTop: 7,
  },

  // Chat messages
  chatArea: {
    flex: 1,
  },

  messageList: {
    padding: 18,
    flexGrow: 1,
    justifyContent: "flex-end",
  },

  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 40,
  },

  emptyIconCircle: {
    height: 96,
    width: 96,
    borderRadius: 32,
    backgroundColor: "#DDF3EF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },

  emptyIcon: {
    fontSize: 43,
  },

  emptyTitle: {
    fontSize: 21,
    fontWeight: "bold",
    color: "#245F57",
  },

  emptySubtitle: {
    textAlign: "center",
    color: "#789A94",
    fontSize: 13,
    lineHeight: 22,
    marginTop: 10,
  },

  emptyDecoration: {
    color: "#83B9AE",
    marginTop: 22,
    fontSize: 16,
  },

  messageWrapper: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    marginBottom: 17,
  },

  receivedMessageWrapper: {
    alignSelf: "flex-start",
  },

  senderLabel: {
    color: "#168F83",
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 6,
    textAlign: "right",
    marginRight: 5,
    letterSpacing: 1,
  },

  receivedSenderLabel: {
    textAlign: "left",
    color: "#6A9B90",
    marginLeft: 5,
  },

  messageBubble: {
    backgroundColor: "#DDF3EF",
    borderRadius: 19,
    borderBottomRightRadius: 5,
    padding: 14,
    elevation: 2,
    shadowColor: "#7FAFA5",
    shadowOpacity: 0.13,
    shadowRadius: 5,
  },

  receivedMessageBubble: {
    backgroundColor: "#FFFFFF",
    borderBottomRightRadius: 19,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: "#DCEDE9",
  },

  messageText: {
    color: "#285B54",
    fontSize: 15,
    lineHeight: 22,
  },

  messageStatus: {
    fontSize: 10,
    color: "#73958E",
    marginTop: 5,
    fontStyle: "italic",
  },

  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },

  timeText: {
    fontSize: 10,
    color: "#82A29C",
  },

  expiryBadge: {
    backgroundColor: "#FCE9E6",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },

  expiryText: {
    color: "#B96E62",
    fontSize: 10,
    fontWeight: "bold",
  },

  // Message input
  inputSection: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: Platform.OS === "android" ? 12 : 18,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 8,
    shadowColor: "#568B81",
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },

  inputHint: {
    fontSize: 10,
    color: "#568B81",
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 9,
    marginLeft: 5,
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F9F7",
    borderRadius: 25,
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#D9EAE6",
  },

  textInput: {
    flex: 1,
    color: "#285B54",
    fontSize: 14,
    paddingVertical: 10,
    maxHeight: 85,
    minHeight: 42,
  },

  sendButton: {
    height: 42,
    width: 42,
    borderRadius: 16,
    backgroundColor: "#B9DCD5",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  activeSendButton: {
    backgroundColor: "#168F83",
  },

  sendIcon: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "bold",
  },

  bottomText: {
    textAlign: "center",
    color: "#91AAA5",
    fontSize: 10,
    marginTop: 12,
  },
});
