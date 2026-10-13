package com.mine.focus;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

// 纯JVM可测试的分块密码核心。块位置、文件名和总长度全部进入AAD，禁止换序或跨文件替换。
final class BackupChunkCrypto {
    private BackupChunkCrypto() {}

    static Cipher cipher(int mode, SecretKeySpec key, byte[] iv, byte[] magic, int version, long sequence, int type, String name, long totalSize, int chunkIndex, int chunkCount, int plainSize) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, iv));
        ByteArrayOutputStream aadBytes = new ByteArrayOutputStream();
        DataOutputStream aad = new DataOutputStream(aadBytes);
        aad.write(magic);
        aad.writeInt(version);
        aad.writeLong(sequence);
        aad.writeByte(type);
        byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
        aad.writeInt(nameBytes.length);
        aad.write(nameBytes);
        aad.writeLong(totalSize);
        aad.writeInt(chunkIndex);
        aad.writeInt(chunkCount);
        aad.writeInt(plainSize);
        aad.flush();
        cipher.updateAAD(aadBytes.toByteArray());
        return cipher;
    }
}
