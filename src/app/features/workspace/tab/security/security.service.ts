import { Injectable, signal, computed } from '@angular/core';
import { SecurityScan, Vulnerability, SecuritySummary } from './models/security.model';
import { generateId } from '@features/workspace/tab/regression/models/flow.model';

@Injectable({
  providedIn: 'root'
})
export class SecurityService {
  readonly scans = signal<SecurityScan[]>(this.seedScans());
  readonly activeScanId = signal<string | null>(null);

  readonly summary = computed<SecuritySummary>(() => {
    const all = this.scans();
    let critical = 0, high = 0, medium = 0, low = 0;
    let totalScore = 0;

    all.forEach(s => {
      totalScore += s.score;
      s.vulnerabilities.forEach(v => {
        if (v.severity === 'critical') critical++;
        else if (v.severity === 'high') high++;
        else if (v.severity === 'medium') medium++;
        else if (v.severity === 'low') low++;
      });
    });

    return {
      totalScans: all.length,
      criticalIssues: critical,
      highIssues: high,
      mediumIssues: medium,
      lowIssues: low,
      avgScore: all.length > 0 ? Math.round(totalScore / all.length) : 100
    };
  });

  startScan(name: string, targetId: string, targetType: SecurityScan['targetType']): string {
    const newScan: SecurityScan = {
      id: generateId(),
      name,
      targetId,
      targetType,
      status: 'running',
      progress: 0,
      vulnerabilities: [],
      startedAt: new Date().toISOString(),
      score: 100
    };

    this.scans.update(prev => [newScan, ...prev]);
    this.simulateScan(newScan.id);
    return newScan.id;
  }

  private simulateScan(id: string) {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        this.completeScan(id);
      } else {
        this.updateScan(id, { progress });
        
        // Randomly find a vulnerability during scan
        if (Math.random() > 0.8) {
          this.addVulnerability(id, this.generateRandomVulnerability());
        }
      }
    }, 800);
  }

  private updateScan(id: string, partial: Partial<SecurityScan>) {
    this.scans.update(prev => prev.map(s => s.id === id ? { ...s, ...partial } : s));
  }

  private addVulnerability(scanId: string, v: Vulnerability) {
    this.scans.update(prev => prev.map(s => {
      if (s.id !== scanId) return s;
      const vulns = [...s.vulnerabilities, v];
      const penalty = v.severity === 'critical' ? 25 : v.severity === 'high' ? 15 : 5;
      return { 
        ...s, 
        vulnerabilities: vulns,
        score: Math.max(0, s.score - penalty)
      };
    }));
  }

  private completeScan(id: string) {
    this.updateScan(id, { 
      status: 'completed', 
      progress: 100, 
      completedAt: new Date().toISOString() 
    });
  }

  private generateRandomVulnerability(): Vulnerability {
    const types = [
      { title: 'SQL Injection', severity: 'critical', cat: 'Injection', rec: 'Use parameterized queries.' },
      { title: 'XSS (Cross-Site Scripting)', severity: 'high', cat: 'Injection', rec: 'Sanitize all user inputs.' },
      { title: 'Missing Security Headers', severity: 'low', cat: 'Configuration', rec: 'Enable HSTS and CSP.' },
      { title: 'Sensitive Data Exposure', severity: 'high', cat: 'Data Leakage', rec: 'Encrypt data at rest and in transit.' },
      { title: 'Broken Authentication', severity: 'critical', cat: 'Authentication', rec: 'Implement multi-factor authentication.' }
    ];
    const type = types[Math.floor(Math.random() * types.length)];
    
    return {
      id: generateId(),
      title: type.title,
      description: `Potential ${type.title} vulnerability detected in endpoint parameters.`,
      severity: type.severity as any,
      category: type.cat,
      recommendation: type.rec,
      detectedAt: new Date().toISOString()
    };
  }

  private seedScans(): SecurityScan[] {
    return [
      {
        id: 's-preseed-1',
        name: 'Production API Audit',
        targetId: 'prod-coll',
        targetType: 'collection',
        status: 'completed',
        progress: 100,
        score: 82,
        startedAt: new Date(Date.now() - 86400000).toISOString(),
        completedAt: new Date(Date.now() - 86340000).toISOString(),
        vulnerabilities: [
          {
            id: 'v1',
            title: 'Missing Content-Security-Policy',
            severity: 'low',
            category: 'Configuration',
            description: 'The response does not include a CSP header.',
            recommendation: 'Add a restrictive CSP header to prevent XSS attacks.',
            detectedAt: new Date().toISOString()
          },
          {
            id: 'v2',
            title: 'Verbose Error Messages',
            severity: 'medium',
            category: 'Information Disclosure',
            description: 'Stack traces are being returned in 500 responses.',
            recommendation: 'Genericize error messages for production environments.',
            detectedAt: new Date().toISOString()
          }
        ]
      }
    ];
  }
}
