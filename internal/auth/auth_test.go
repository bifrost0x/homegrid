package auth

import "testing"

func TestPasswordHashAndTokens(t *testing.T) {
	hash, e := Hash("a long password")
	if e != nil {
		t.Fatal(e)
	}
	if !Verify(hash, "a long password") || Verify(hash, "wrong") || Verify("malformed", "a long password") {
		t.Fatal("password verification failed")
	}
	a, b := Token(), Token()
	if a == b || len(a) != 64 || TokenHash(a) == a || TokenHash(a) != TokenHash(a) {
		t.Fatal("invalid session tokens")
	}
}
