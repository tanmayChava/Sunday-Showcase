/**
 * Channel Abstraction Types
 *
 * Defines a platform-agnostic interface for messaging channels.
 * Any platform adapter (Telegram, Discord, CLI, etc.) implements
 * the Channel interface to plug into SUNDAY's agent loop.
 */

/**
 * An incoming message from any channel, normalized into a common shape.
 */
export interface IncomingMessage {
  /** Unique chat/conversation ID (string for cross-platform compat) */
  chatId: string;
  /** Unique user ID */
  userId: string;
  /** Text content (undefined for image-only messages) */
  text?: string;
  /** Base64-encoded image data (for vision queries) */
  imageBase64?: string;
  /** MIME type of the image (e.g. "image/jpeg") */
  imageMimeType?: string;
  /** Extracted text from an uploaded document (PDF, TXT, MD, etc.) */
  documentText?: string;
}

/**
 * Handler function that processes an incoming message and returns a text response.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<string>;

/**
 * The Channel interface — every platform adapter must implement this.
 */
export interface Channel {
  /** Human-readable name of this channel (e.g. "Telegram", "Discord") */
  readonly name: string;

  /**
   * Start the channel (connect, begin polling/listening).
   * Must call the registered message handler for every incoming message.
   */
  start(): Promise<void>;

  /** Stop the channel gracefully. */
  stop(): void;

  /**
   * Register the message handler that the channel should call
   * when it receives a message.
   */
  onMessage(handler: MessageHandler): void;

  /** Send a text response back to a chat. */
  sendText(chatId: string, text: string): Promise<void>;

  /** Send a typing/processing indicator to a chat. */
  sendTyping(chatId: string): Promise<void>;
}
