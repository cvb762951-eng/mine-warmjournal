package com.mine.focus;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.util.Arrays;
import javax.crypto.spec.SecretKeySpec;

/** Exercises the production archive writer and reader, not a second implementation. */
public class BackupArchiveRoundTripTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private final StreamingBackupPlugin plugin = new StreamingBackupPlugin();
    private final SecretKeySpec key = new SecretKeySpec(new byte[32], "AES");
    private Object invoke(String name, Object... args) throws Exception {
        for (Method method : StreamingBackupPlugin.class.getDeclaredMethods()) {
            if (method.getName().equals(name)) {
                method.setAccessible(true);
                try { return method.invoke(plugin, args); }
                catch (InvocationTargetException error) { throw (Exception) error.getCause(); }
            }
        }
        throw new NoSuchMethodException(name);
    }
    private byte[] archive() throws Exception {
        Class<?> statsClass = Class.forName("com.mine.focus.StreamingBackupPlugin$ArchiveStats");
        Constructor<?> ctor = statsClass.getDeclaredConstructor(); ctor.setAccessible(true);
        Object stats = ctor.newInstance();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        invoke("writeV3BytesRecord", out, key, stats, 1, "state.json", "{\"test\":true}".getBytes("UTF-8"));
        File source = temp.newFile();
        byte[] media = new byte[8 * 1024 * 1024 + 173];
        for (int i = 0; i < media.length; i++) media[i] = (byte)(i * 31);
        Files.write(source.toPath(), media);
        invoke("writeFileRecord", out, key, stats, 2, "clip.mp4", source);
        Field records = statsClass.getDeclaredField("records"); records.setAccessible(true);
        Field size = statsClass.getDeclaredField("bytes"); size.setAccessible(true);
        invoke("writeV3BytesRecord", out, key, stats, 127, "manifest", (records.getLong(stats) + ":" + size.getLong(stats)).getBytes("US-ASCII"));
        return bytes.toByteArray();
    }
    private String restore(byte[] bytes, SecretKeySpec restoreKey, File destination) throws Exception {
        return (String)invoke("extractV3Archive", new DataInputStream(new ByteArrayInputStream(bytes)), restoreKey, destination, temp.newFolder(), null);
    }
    @Test public void multiChunkFileRestoresByteForByte() throws Exception {
        byte[] bytes = archive(); File destination = temp.newFolder();
        assertEquals("{\"test\":true}", restore(bytes, key, destination));
        byte[] media = Files.readAllBytes(new File(destination, "clip.mp4").toPath());
        assertEquals(8 * 1024 * 1024 + 173, media.length);
        for (int i = 0; i < media.length; i++) if (media[i] != (byte)(i * 31)) fail("Byte mismatch: " + i);
    }
    @Test public void wrongKeyTruncationAndTamperingFail() throws Exception {
        byte[] bytes = archive(); byte[] wrong = new byte[32]; wrong[0] = 1;
        assertThrows(javax.crypto.AEADBadTagException.class, () -> restore(bytes, new SecretKeySpec(wrong, "AES"), temp.newFolder()));
        assertThrows(EOFException.class, () -> restore(Arrays.copyOf(bytes, bytes.length - 10), key, temp.newFolder()));
        bytes[bytes.length / 2] ^= 1;
        assertThrows(javax.crypto.AEADBadTagException.class, () -> restore(bytes, key, temp.newFolder()));
    }
}
