package com.mine.focus;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertThrows;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

import org.junit.Test;

public class BackupChunkCryptoTest {
    private static final byte[] MAGIC = "MINEBK2\n".getBytes(StandardCharsets.US_ASCII);

    @Test
    public void eightMegabyteChunkRoundTripsWithFixedMemory() throws Exception {
        byte[] plain = new byte[8 * 1024 * 1024];
        byte[] keyBytes = new byte[32];
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(plain);
        new SecureRandom().nextBytes(keyBytes);
        new SecureRandom().nextBytes(iv);
        SecretKeySpec key = new SecretKeySpec(keyBytes, "AES");
        Cipher encrypt = BackupChunkCrypto.cipher(Cipher.ENCRYPT_MODE, key, iv, MAGIC, 3, 7L, 2, "video/a.mp4", 20L * 1024L * 1024L, 0, 3, plain.length);
        byte[] encrypted = new byte[plain.length + 16];
        int encryptedSize = encrypt.doFinal(plain, 0, plain.length, encrypted, 0);
        Cipher decrypt = BackupChunkCrypto.cipher(Cipher.DECRYPT_MODE, key, iv, MAGIC, 3, 7L, 2, "video/a.mp4", 20L * 1024L * 1024L, 0, 3, plain.length);
        byte[] restored = new byte[plain.length];
        int restoredSize = decrypt.doFinal(encrypted, 0, encryptedSize, restored, 0);
        assertArrayEquals(plain, java.util.Arrays.copyOf(restored, restoredSize));
    }

    @Test
    public void tamperOrChunkReorderingIsRejected() throws Exception {
        byte[] plain = "authenticated block".getBytes(StandardCharsets.UTF_8);
        byte[] keyBytes = new byte[32];
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(keyBytes);
        new SecureRandom().nextBytes(iv);
        SecretKeySpec key = new SecretKeySpec(keyBytes, "AES");
        byte[] encrypted = BackupChunkCrypto.cipher(Cipher.ENCRYPT_MODE, key, iv, MAGIC, 3, 4L, 3, "vault/x", plain.length * 2L, 0, 2, plain.length).doFinal(plain);
        encrypted[3] ^= 1;
        Cipher tampered = BackupChunkCrypto.cipher(Cipher.DECRYPT_MODE, key, iv, MAGIC, 3, 4L, 3, "vault/x", plain.length * 2L, 0, 2, plain.length);
        assertThrows(AEADBadTagException.class, () -> tampered.doFinal(encrypted));
        encrypted[3] ^= 1;
        Cipher reordered = BackupChunkCrypto.cipher(Cipher.DECRYPT_MODE, key, iv, MAGIC, 3, 4L, 3, "vault/x", plain.length * 2L, 1, 2, plain.length);
        assertThrows(AEADBadTagException.class, () -> reordered.doFinal(encrypted));
    }
}
