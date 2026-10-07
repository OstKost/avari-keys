package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

var (
	defaultTransport = &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}
	sharedHTTPClient = &http.Client{
		Timeout:   15 * time.Second,
		Transport: defaultTransport,
	}
)

// SlaveClient communicates with a remote or local Slave API instance.
type SlaveClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewSlaveClient creates a new SlaveClient.
func NewSlaveClient(baseURL, apiKey string) *SlaveClient {
	baseURL = strings.TrimRight(baseURL, "/")
	return &SlaveClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: sharedHTTPClient,
	}
}

// CheckHealth verifies connection to the Slave API node.
func (c *SlaveClient) CheckHealth(ctx context.Context) (*models.HealthResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("slave health check returned status %d", resp.StatusCode)
	}

	var res models.HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

// CreateClient requests the Slave to create a new client config.
func (c *SlaveClient) CreateClient(ctx context.Context, clientName string, psk bool, protocol ...string) (*models.ClientResponse, error) {
	proto := "awg"
	if len(protocol) > 0 && protocol[0] != "" {
		proto = protocol[0]
	}
	body, err := json.Marshal(models.ClientCreateRequest{
		Name:     clientName,
		PSK:      psk,
		Protocol: proto,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/clients", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("slave create client failed with status %d: %s", resp.StatusCode, errResp["error"])
	}

	var res models.ClientResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

// GetClient retrieves the config and QR code for an existing client from Slave.
func (c *SlaveClient) GetClient(ctx context.Context, clientName string) (*models.ClientResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/api/v1/clients/%s", c.baseURL, clientName), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("slave get client failed with status %d: %s", resp.StatusCode, errResp["error"])
	}

	var res models.ClientResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

// DeleteClient requests the Slave to delete a client config.
func (c *SlaveClient) DeleteClient(ctx context.Context, clientName string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, fmt.Sprintf("%s/api/v1/clients/%s", c.baseURL, clientName), nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return fmt.Errorf("slave delete client failed with status %d: %s", resp.StatusCode, errResp["error"])
	}
	return nil
}

// GetStats fetches statistical information from the node.
func (c *SlaveClient) GetStats(ctx context.Context) (*models.StatsSummaryResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/stats", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("slave stats failed with status %d: %s", resp.StatusCode, errResp["error"])
	}

	var res models.StatsSummaryResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

// Restart requests the Slave to restart the AmneziaWG service.
func (c *SlaveClient) Restart(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/restart", nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return fmt.Errorf("slave restart failed with status %d: %s", resp.StatusCode, errResp["error"])
	}
	return nil
}

// Backup requests the Slave to create and return a backup archive.
func (c *SlaveClient) Backup(ctx context.Context) (*models.BackupResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/backup", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("slave backup failed with status %d: %s", resp.StatusCode, errResp["error"])
	}

	var res models.BackupResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

// Restore sends a backup archive to the Slave to restore configurations.
func (c *SlaveClient) Restore(ctx context.Context, backupData string) error {
	body, err := json.Marshal(models.RestoreNodeRequest{BackupData: backupData})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/restore", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return fmt.Errorf("slave restore failed with status %d: %s", resp.StatusCode, errResp["error"])
	}
	return nil
}

// GetCascadeEgress retrieves the active and available egress interfaces for a cascade node.
func (c *SlaveClient) GetCascadeEgress(ctx context.Context) (*models.EgressStatusResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/cascade/egress", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("slave get cascade egress failed with status %d: %s", resp.StatusCode, errResp["error"])
	}

	var res models.EgressStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

// SwitchCascadeEgress requests the Slave to switch active egress interface (e.g. 'awg1' or 'awg3').
func (c *SlaveClient) SwitchCascadeEgress(ctx context.Context, devName string) error {
	body, err := json.Marshal(models.SwitchEgressRequest{Interface: devName})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/cascade/egress", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]string
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return fmt.Errorf("slave switch cascade egress failed with status %d: %s", resp.StatusCode, errResp["error"])
	}
	return nil
}

