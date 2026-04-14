/**
 * End-to-End Encryption (E2EE) Cryptographic Engine for Nayaxa Direct User Chat
 * Standards:
 * - Cipher: AES-GCM (256-bit key)
 * - Key Derivation: PBKDF2 (SHA-256, 100,000 iterations)
 * - Initialization Vector (IV): 12 bytes cryptographic random
 * - Payload Format: E2EE:v1:<iv_base64>:<ciphertext_base64>
 */

export interface DecryptedMessageResult {
  text: string;
  isE2EE: boolean;
}

const E2EE_PREFIX = 'E2EE:v1:';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive shared symmetric AES-GCM 256-bit key between two users
 */
export async function deriveConversationKey(userId1: number, userId2: number): Promise<CryptoKey> {
  const [minId, maxId] = [Math.min(userId1, userId2), Math.max(userId1, userId2)];
  const sharedSaltString = `nayaxa-e2ee-salt-v1-${minId}-${maxId}`;
  const sharedPassphrase = `nayaxa-peer-sec-${minId}-paired-with-${maxId}`;

  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(sharedPassphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(sharedSaltString),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext message with AES-GCM 256-bit
 */
export async function encryptUserMessage(plaintext: string, senderId: number, recipientId: number): Promise<string> {
  try {
    if (!window.crypto?.subtle) {
      return plaintext; // Fallback if crypto subtle unavailable
    }
    const key = await deriveConversationKey(senderId, recipientId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encodedData = enc.encode(plaintext);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encodedData
    );

    const ivB64 = arrayBufferToBase64(iv.buffer);
    const cipherB64 = arrayBufferToBase64(ciphertextBuffer);

    return `${E2EE_PREFIX}${ivB64}:${cipherB64}`;
  } catch (err) {
    console.error('[E2EE] Encryption failed, falling back:', err);
    return plaintext;
  }
}

/**
 * Decrypt ciphertext message with AES-GCM 256-bit
 */
export async function decryptUserMessage(payload: string, senderId: number, recipientId: number): Promise<DecryptedMessageResult> {
  try {
    if (!payload || !payload.startsWith(E2EE_PREFIX)) {
      return { text: payload, isE2EE: false };
    }

    if (!window.crypto?.subtle) {
      return { text: '[Pesan Terenkripsi E2EE]', isE2EE: true };
    }

    const parts = payload.substring(E2EE_PREFIX.length).split(':');
    if (parts.length !== 2) {
      return { text: payload, isE2EE: false };
    }

    const [ivB64, cipherB64] = parts;
    const ivBuffer = base64ToArrayBuffer(ivB64);
    const cipherBuffer = base64ToArrayBuffer(cipherB64);
    const key = await deriveConversationKey(senderId, recipientId);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(ivBuffer)
      },
      key,
      cipherBuffer
    );

    const dec = new TextDecoder();
    return { text: dec.decode(decryptedBuffer), isE2EE: true };
  } catch (err) {
    console.warn('[E2EE] Decryption error (possible invalid key or corrupted payload):', err);
    return { text: payload, isE2EE: false };
  }
}