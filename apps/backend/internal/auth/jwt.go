package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type contextKey string

const userContextKey contextKey = "auth_user"

// JWTManager handles signing and validating JWT tokens.
type JWTManager struct {
	secretKey     []byte
	tokenDuration time.Duration
}

// UserClaims contains custom claims stored in the JWT.
type UserClaims struct {
	UserID   int64       `json:"user_id"`
	Username string      `json:"username"`
	Role     models.Role `json:"role"`
	jwt.RegisteredClaims
}

// NewJWTManager creates a new JWTManager.
func NewJWTManager(secretKey string, duration time.Duration) *JWTManager {
	if secretKey == "" || secretKey == "avari-keys-mvp-default-super-secret-key-change-in-prod" {
		isProd := os.Getenv("APP_ENV") == "production" || os.Getenv("ENV") == "prod"
		if isProd {
			log.Fatalf("[FATAL] Production requires a secure JWT_SECRET environment variable to be set!")
		}
		if secretKey == "" {
			buf := make([]byte, 32)
			_, _ = rand.Read(buf)
			secretKey = hex.EncodeToString(buf)
		}
	}
	if duration == 0 {
		duration = 72 * time.Hour
	}
	return &JWTManager{
		secretKey:     []byte(secretKey),
		tokenDuration: duration,
	}
}

// CheckPassword verifies the password against a bcrypt hash.
func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateToken generates a JWT token for a user.
func (m *JWTManager) GenerateToken(user *models.User) (string, error) {
	claims := UserClaims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.tokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secretKey)
}

// VerifyToken validates a JWT token and returns the claims.
func (m *JWTManager) VerifyToken(tokenStr string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected token signing method")
		}
		return m.secretKey, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*UserClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// AuthMiddleware extracts JWT token from Authorization header or Cookie and attaches claims to context.
func (m *JWTManager) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr := ""

		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		} else if cookie, err := r.Cookie("token"); err == nil {
			tokenStr = cookie.Value
		}

		if tokenStr != "" {
			claims, err := m.VerifyToken(tokenStr)
			if err == nil {
				ctx := context.WithValue(r.Context(), userContextKey, claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

// GetUserFromContext retrieves authenticated UserClaims from context.
func GetUserFromContext(ctx context.Context) (*UserClaims, bool) {
	claims, ok := ctx.Value(userContextKey).(*UserClaims)
	return claims, ok && claims != nil
}

// RequireAuth enforces that a valid user is authenticated.
func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := GetUserFromContext(r.Context())
		if !ok || claims == nil {
			http.Error(w, `{"error":"Unauthorized: authentication required"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// RequireAdmin enforces that the authenticated user has the 'admin' role.
func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := GetUserFromContext(r.Context())
		if !ok || claims == nil {
			http.Error(w, `{"error":"Unauthorized: authentication required"}`, http.StatusUnauthorized)
			return
		}
		if claims.Role != models.RoleAdmin {
			http.Error(w, `{"error":"Forbidden: admin privileges required"}`, http.StatusForbidden)
			return
		}
		next(w, r)
	}
}
