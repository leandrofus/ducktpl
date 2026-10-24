// duck:file multitenant
package store

import (
	"context"
	"database/sql"
	"fmt"
)

type tenantKey struct{}

// WithTenant stores the tenant ID in the context.
func WithTenant(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, tenantKey{}, tenantID)
}

// TenantFrom returns the tenant ID stored in ctx, or empty string.
func TenantFrom(ctx context.Context) string {
	if v, ok := ctx.Value(tenantKey{}).(string); ok {
		return v
	}
	return ""
}

// SetTenantSession sets the RLS current_tenant variable for PostgreSQL transactions.
func SetTenantSession(ctx context.Context, tx *sql.Tx, tenantID string) error {
	if tenantID == "" {
		return nil
	}
	clean := sanitizeTenant(tenantID)
	_, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", clean))
	return err
}

func sanitizeTenant(s string) string {
	var b []rune
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b = append(b, r)
		}
	}
	return string(b)
}
