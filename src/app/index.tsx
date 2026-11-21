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
const DISPLAY_NAME = "Maryam";
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

  // Connect to the class relay
  useEffect(() => {
    if (!deviceId) return;

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
          name: DISPLAY_NAME,
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

        // Relay successfully accepted our connection
        if (data.type === "welcome" && typeof data.server_time === "number") {
          reconnectAttemptRef.current = 0;

          serverTimeOffsetRef.current = data.server_time - Date.now();

          setRelayStatus("Connected");
          console.log("Joined relay successfully!");
        }

        // Relay error
        else if (data.type === "error") {
          setRelayStatus("Relay error");
          console.log("Relay error:", data);
        }

        // Heartbeat response
        else if (data.type === "pong") {
          lastPongAtRef.current = Date.now();
          console.log("Relay heartbeat received");
        }
        // Presence update from relay
        else if (
          data.type === "presence" &&
          typeof data.count === "number" &&
          Array.isArray(data.members) &&
          data.members.every((member: unknown) => typeof member === "string")
        ) {
          setMemberCount(data.count);
          setConnectedMembers(data.members);

          console.log("Connected members:", data.members);
        }

        // Message acknowledgement
        else if (data.type === "delivered" && typeof data.id === "string") {
          pendingMessageIdsRef.current.delete(data.id);

          console.log(
            "Relay acknowledged message:",
            data.id,
            "Recipients:",
            data.count,
          );

          setMessages((previousMessages) =>
            previousMessages.map((message) =>
              message.id === data.id ? { ...message, status: "sent" } : message,
            ),
          );
        }

        // Incoming messages from the relay
        else if (
          data.type === "message" &&
          typeof data.id === "string" &&
          typeof data.text === "string" &&
          typeof data.sender === "string" &&
          typeof data.expires_at === "number" &&
          typeof data.sent_at === "number"
        ) {
          // Ignore duplicate messages
          if (seenMessageIdsRef.current.has(data.id)) {
            return;
          }

          seenMessageIdsRef.current.add(data.id);

          // Convert relay time into this phone's clock
          const localExpiry = data.expires_at - serverTimeOffsetRef.current;

          const localSentTime = data.sent_at - serverTimeOffsetRef.current;

          // Never display an already expired message
          if (localExpiry <= Date.now()) {
            return;
          }

          const incomingMessage: Message = {
            id: data.id,
            text: data.text,
            sender: data.sender,
            createdAt: localSentTime,
            expiresAt: localExpiry,
            status: "sent",
            isMine: data.sender === DISPLAY_NAME,
          };

          setMessages((previousMessages) => {
            // Additional duplicate protection
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
        }

        // Relay says a message has expired
        else if (data.type === "expired" && typeof data.id === "string") {
          pendingMessageIdsRef.current.delete(data.id);

          setMessages((previousMessages) =>
            previousMessages.filter((message) => message.id !== data.id),
          );

          setMessageQueue((previousQueue) =>
            previousQueue.filter((message) => message.id !== data.id),
          );

          console.log("Message expired:", data.id);
        }
      } catch (error) {
        console.log("Invalid relay response:", error);
      }
    };

    socket.onerror = () => {
      if (active) {
        setRelayStatus("Connection error");
      }
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
  }, [deviceId, isOnline, reconnectKey]);

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

          // Restore IDs to prevent duplicate display
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

  // Update timer and remove expired messages
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
      if (state === "active") {
        updateMessages();
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded || !isOnline || relayStatus !== "Connected") {
      return;
    }

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const currentTime = Date.now();

    // Remove expired messages only if there are any
    const hasExpiredMessages = messageQueue.some(
      (message) => message.expiresAt <= currentTime,
    );

    if (hasExpiredMessages) {
      setMessageQueue((previousQueue) =>
        previousQueue.filter((message) => message.expiresAt > Date.now()),
      );
    }

    // Send only valid messages
    const validMessages = messageQueue.filter(
      (message) => message.expiresAt > currentTime,
    );

    validMessages.forEach((message) => {
      if (pendingMessageIdsRef.current.has(message.id)) {
        return;
      }

      if (message.expiresAt <= Date.now()) {
        return;
      }

      try {
        pendingMessageIdsRef.current.add(message.id);

        socket.send(
          JSON.stringify({
            type: "message",
            id: message.id,
            sender: DISPLAY_NAME,
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
  }, [messageQueue, isLoaded, isOnline, relayStatus]);

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
      sender: DISPLAY_NAME,
      isMine: true,
    };

    seenMessageIdsRef.current.add(newMessage.id);

    setMessages((previousMessages) => [...previousMessages, newMessage]);

    setMessageQueue((previousQueue) => [...previousQueue, newMessage]);

    setInput("");
  };

  // Get readable message status
  const getMessageStatus = (message: Message) => {
    if (message.status === "waiting") {
      return "Waiting for server...";
    }

    if (message.isMine === false) {
      return "Received";
    }

    return "Sent";
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="dark-content" />
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
                {
                  backgroundColor: isOnline ? "#79B995" : "#E58B9B",
                },
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
          <Text style={styles.presenceTitle}>Connected: {memberCount}</Text>

          <Text style={styles.presenceNames}>
            {connectedMembers.length > 0
              ? connectedMembers.join(", ")
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
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Text style={styles.emptyIcon}>💌</Text>
            </View>

            <Text style={styles.emptyTitle}>A little quiet here...</Text>

            <Text style={styles.emptySubtitle}>
              Send your first message and{"\n"}
              let the conversation begin! 🌷
            </Text>

            <Text style={styles.emptyDecoration}>─── ♡ ───</Text>
          </View>
        }
        renderItem={({ item }) => {
          const secondsLeft = Math.max(
            0,
            Math.ceil((item.expiresAt - now) / 1000),
          );

          const messageTime = new Date(item.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          const isMine = item.isMine !== false;

          return (
            <View
              style={[
                styles.messageWrapper,
                !isMine && styles.receivedMessageWrapper,
              ]}
            >
              <Text style={styles.senderLabel}>
                {isMine ? "YOU ♡" : `${item.sender || "CLASSMATE"} ♡`}
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
        <Text style={styles.inputHint}>SHARE A LITTLE SOMETHING ♡</Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Type something sweet..."
            placeholderTextColor="#A59AAF"
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
          />

          <TouchableOpacity
            style={[
              styles.sendButton,
              input.trim() !== "" && styles.activeSendButton,
            ]}
            onPress={sendMessage}
            activeOpacity={0.8}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.bottomText}>
          made for little class conversations ✿
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FBF8FF",
  },

  header: {
    backgroundColor: "#F0E7FF",
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "center",
  },

  logoCircle: {
    height: 50,
    width: 50,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },

  logo: {
    fontSize: 29,
    color: "#9B75C9",
  },

  titleArea: {
    flex: 1,
    marginLeft: 12,
  },

  headerTitle: {
    fontSize: 23,
    fontWeight: "bold",
    color: "#55416D",
  },

  headerSubtitle: {
    fontSize: 12,
    color: "#8B76A0",
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
    color: "#82639F",
    fontWeight: "bold",
  },

  notice: {
    backgroundColor: "#FAF5FF",
    marginTop: 17,
    padding: 11,
    borderRadius: 13,
    alignItems: "center",
  },

  noticeText: {
    color: "#80669A",
    fontSize: 12,
    fontWeight: "600",
  },

  relayText: {
    color: "#80669A",
    fontSize: 10,
    marginTop: 5,
  },

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
    height: 100,
    width: 100,
    borderRadius: 35,
    backgroundColor: "#F0E7FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },

  emptyIcon: {
    fontSize: 46,
  },

  emptyTitle: {
    fontSize: 21,
    fontWeight: "bold",
    color: "#614D78",
  },

  emptySubtitle: {
    textAlign: "center",
    color: "#A090B1",
    fontSize: 14,
    lineHeight: 23,
    marginTop: 10,
  },

  emptyDecoration: {
    color: "#C4A9DE",
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
    color: "#9B7BB8",
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 6,
    textAlign: "right",
    marginRight: 5,
    letterSpacing: 1,
  },

  messageBubble: {
    backgroundColor: "#EEE3FA",
    borderRadius: 20,
    borderBottomRightRadius: 5,
    padding: 14,
    elevation: 2,
    shadowColor: "#C7B4D9",
    shadowOpacity: 0.15,
    shadowRadius: 5,
  },

  receivedMessageBubble: {
    backgroundColor: "#E4F3EA",
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 5,
  },

  messageText: {
    color: "#51405F",
    fontSize: 15,
    lineHeight: 22,
  },

  messageStatus: {
    fontSize: 10,
    color: "#8B789E",
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
    color: "#9985AA",
  },

  expiryBadge: {
    backgroundColor: "#F9DCE8",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },

  expiryText: {
    color: "#B65E83",
    fontSize: 10,
    fontWeight: "bold",
  },

  inputSection: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 18,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    elevation: 8,
  },

  inputHint: {
    fontSize: 10,
    color: "#A28CB7",
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 9,
    marginLeft: 5,
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F3FC",
    borderRadius: 25,
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#EDE3F5",
  },

  textInput: {
    flex: 1,
    color: "#51405F",
    fontSize: 14,
    paddingVertical: 10,
    maxHeight: 85,
  },

  sendButton: {
    height: 42,
    width: 42,
    borderRadius: 16,
    backgroundColor: "#DCCCEB",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  activeSendButton: {
    backgroundColor: "#A77ACB",
  },

  sendIcon: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "bold",
  },

  bottomText: {
    textAlign: "center",
    color: "#B6A7C3",
    fontSize: 10,
    marginTop: 12,
  },
  presenceContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#F0E8FA",
    borderRadius: 12,
  },

  presenceTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#76528F",
  },

  presenceNames: {
    fontSize: 12,
    color: "#6D6475",
    marginTop: 4,
  },
});
