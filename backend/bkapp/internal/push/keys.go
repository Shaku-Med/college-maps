package push

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/internal/config"
)

// The Web Push keypair has to be the same on every instance and survive every deploy: browsers subscribe
// against the public key, so a new keypair silently breaks every subscription. Hosts like Vercel have no
// disk that lasts, so the keypair lives in the database, made once and sealed with a key derived from
// AUTH_SECRET. A copy of the database alone does not reveal the private key.

const (
	vapidRow        = "vapid"
	sealVersion     = 1
	sealNonceBytes  = 12
	keySealingLabel = "csimap/push/v1/key-sealing"
)

// ErrKeysUnreadable means stored keys exist but cannot be opened, most likely because AUTH_SECRET changed.
// Notifications stay off instead of quietly replacing keys that subscriptions depend on.
var ErrKeysUnreadable = errors.New("stored notification keys could not be decrypted with this AUTH_SECRET")

type vapidKeys struct {
	Public  string `json:"public"`
	Private string `json:"private"`
	Subject string `json:"subject"`
}

func sealer(secret []byte) (cipher.AEAD, error) {
	if len(secret) < 32 {
		return nil, errors.New("auth secret must be at least 32 bytes")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(keySealingLabel))
	block, err := aes.NewCipher(mac.Sum(nil))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// seal binds the ciphertext to its row name, so a sealed value moved to another row does not open.
func seal(aead cipher.AEAD, name string, plain []byte) ([]byte, error) {
	nonce := make([]byte, sealNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := append([]byte{sealVersion}, nonce...)
	return aead.Seal(out, nonce, plain, []byte("app_keys:"+name)), nil
}

func open(aead cipher.AEAD, name string, sealed []byte) ([]byte, error) {
	if len(sealed) < 1+sealNonceBytes+aead.Overhead() || sealed[0] != sealVersion {
		return nil, ErrKeysUnreadable
	}
	nonce := sealed[1 : 1+sealNonceBytes]
	plain, err := aead.Open(nil, nonce, sealed[1+sealNonceBytes:], []byte("app_keys:"+name))
	if err != nil {
		return nil, ErrKeysUnreadable
	}
	return plain, nil
}

// ResolveKeys settles the keypair every instance uses and writes it into cfg. Keys already in the database
// win. Without them, keys already configured on this machine seed the database, so subscriptions made with
// them keep working, and failing that a new keypair is made. When two instances start at once, both end up
// with whichever keypair was stored first. It connects as the database owner, the only role that can read
// app_keys.
func ResolveKeys(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config) error {
	return resolveKeys(ctx, pool, cfg, vapidRow)
}

// resolveKeys takes the row name so tests can use their own row and never touch the real keys.
func resolveKeys(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, row string) error {
	aead, err := sealer(cfg.AuthSecret)
	if err != nil {
		return err
	}

	keys, found, err := loadKeys(ctx, pool, aead, row)
	if err != nil {
		return err
	}
	if !found {
		candidate := vapidKeys{Public: cfg.VAPIDPublic, Private: cfg.VAPIDPrivate, Subject: cfg.VAPIDSubject}
		if config.ValidVAPID(candidate.Public, candidate.Private, candidate.Subject) != nil {
			public, private, err := config.GenerateVAPIDKeys()
			if err != nil {
				return err
			}
			candidate = vapidKeys{Public: public, Private: private, Subject: config.DefaultVAPIDSubject()}
		}
		plain, err := json.Marshal(candidate)
		if err != nil {
			return err
		}
		sealed, err := seal(aead, row, plain)
		if err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `insert into app_keys (name, sealed) values ($1, $2) on conflict (name) do nothing`, row, sealed); err != nil {
			return fmt.Errorf("store notification keys: %w", err)
		}
		// Read back rather than trusting this instance's copy, in case another one stored first.
		if keys, found, err = loadKeys(ctx, pool, aead, row); err != nil {
			return err
		}
		if !found {
			return errors.New("notification keys were not stored")
		}
	}

	if err := config.ValidVAPID(keys.Public, keys.Private, keys.Subject); err != nil {
		return fmt.Errorf("stored notification keys are not usable: %w", err)
	}
	cfg.VAPIDPublic, cfg.VAPIDPrivate, cfg.VAPIDSubject = keys.Public, keys.Private, keys.Subject
	cfg.PushAvailable = true
	return nil
}

func loadKeys(ctx context.Context, pool *pgxpool.Pool, aead cipher.AEAD, row string) (vapidKeys, bool, error) {
	var sealed []byte
	err := pool.QueryRow(ctx, `select sealed from app_keys where name = $1`, row).Scan(&sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return vapidKeys{}, false, nil
	}
	if err != nil {
		return vapidKeys{}, false, fmt.Errorf("read notification keys: %w", err)
	}
	plain, err := open(aead, row, sealed)
	if err != nil {
		return vapidKeys{}, false, err
	}
	var keys vapidKeys
	if err := json.Unmarshal(plain, &keys); err != nil {
		return vapidKeys{}, false, ErrKeysUnreadable
	}
	return keys, true, nil
}
