package neoread

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

// These paths are a shared protocol with already-installed Word/WPS clients.
// They are live NeoRead connection files, not legacy reading data.
var readerCitationNames = []string{"cite-credential", "cite-wps-key"}
var readerCitationValue = regexp.MustCompile(`^[a-f0-9]{64}$`)

func readReaderCitationFile(path string) ([]byte, bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if !info.Mode().IsRegular() {
		return nil, false, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 65))
	return data, err == nil && readerCitationValue.Match(data), err
}

func readerCitationFiles(source string) (map[string][]byte, error) {
	files := map[string][]byte{}
	for _, name := range readerCitationNames {
		data, valid, err := readReaderCitationFile(filepath.Join(source, name))
		if err != nil {
			return nil, err
		}
		if valid {
			files[name] = data
		}
	}
	return files, nil
}

func checkReaderCleanupDigest(source, target string, state *ReaderMigration, runtimeFiles map[string][]byte) error {
	overrides := map[string]string{}
	for _, name := range readerCitationNames {
		current, valid := runtimeFiles[name]
		if !valid && pathExists(filepath.Join(source, name)) {
			continue
		}
		expected, existed := state.Entries[name]
		if !existed {
			overrides[name] = ""
			continue
		}
		if valid {
			currentHash := sha256.Sum256(current)
			if hex.EncodeToString(currentHash[:]) == expected {
				continue
			}
		}
		// Never change the saved source hash. Reconstruct its original runtime file
		// only from the migrated copy authenticated by the existing entry manifest.
		snapshot := filepath.Join(target, name)
		data, valid, err := readReaderCitationFile(snapshot)
		if err != nil {
			return err
		}
		snapshotHash := sha256.Sum256(data)
		if !valid || hex.EncodeToString(snapshotHash[:]) != expected {
			return migrationErrorf("runtime_snapshot_unverifiable", "旧引用连接文件的迁移副本无法校验，请检查后手动清理旧数据")
		}
		overrides[name] = snapshot
	}
	hash, _, err := treeDigestWithOverrides(source, state.excluded, overrides)
	if err != nil {
		return err
	}
	if hash != state.SourceHash {
		return migrationErrorf("source_changed", "旧 Reader 数据在迁移后发生变化，请检查后手动删除")
	}
	return nil
}

// Detach the whole old tree before deleting anything. Replace its public path
// with just the live connection files, so installed Word/WPS clients keep their
// fixed paths and a Reader launched concurrently never loses newly created data.
func detachReaderData(source, id string, runtimeFiles map[string][]byte) (string, error) {
	parent := filepath.Dir(source)
	tombstone := filepath.Join(parent, ".reader-cleanup-"+id)
	if pathExists(tombstone) {
		return "", fmt.Errorf("旧数据清理目录已存在，未覆盖：%s", tombstone)
	}
	replacement := ""
	if len(runtimeFiles) > 0 {
		var err error
		replacement, err = os.MkdirTemp(parent, ".reader-runtime-"+id+"-")
		if err != nil {
			return "", err
		}
		defer func() {
			if replacement != "" {
				_ = os.RemoveAll(replacement)
			}
		}()
		for name, data := range runtimeFiles {
			if err = os.WriteFile(filepath.Join(replacement, name), data, 0600); err != nil {
				return "", err
			}
		}
		if err = syncMigrationTree(replacement); err != nil {
			return "", err
		}
	}
	if err := os.Rename(source, tombstone); err != nil {
		return "", fmt.Errorf("无法移除旧数据目录，请退出 Reader 后手动删除：%w", err)
	}
	if replacement != "" {
		if err := os.Rename(replacement, source); err != nil {
			if !pathExists(source) {
				if rollback := os.Rename(tombstone, source); rollback == nil {
					return "", migrationErrorf("runtime_restore_failed", "无法保留引用插件连接文件，旧数据已恢复：%w", err)
				}
			}
			return "", migrationErrorf("runtime_restore_failed", "无法保留引用插件连接文件，旧数据保留在 %s：%w", tombstone, err)
		}
		replacement = ""
	}
	if err := syncMigrationDirectory(parent); err != nil {
		return "", fmt.Errorf("旧数据保留在 %s：%w", tombstone, err)
	}
	return tombstone, nil
}
