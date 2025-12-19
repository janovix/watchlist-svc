# PEP Policy Summary - Lista PEPS 2020

This document summarizes the key rules from the official "Lista de Personas Políticamente Expuestas Nacionales 2020" issued by SHCP (Secretaría de Hacienda y Crédito Público) of Mexico.

## Governing Standard

The Lista PEPS 2020 is the official reference document for determining if a person qualifies as a PEP (Politically Exposed Person) in Mexico. All screening must follow these rules.

## Scope

PEP status applies to persons who currently hold or have held in the last 5 years (until December 2025) any of the listed public positions.

## PEP Categories

### Federal Level (SECCIÓN I)

**Executive Power:**

- Presidente de la República
- Secretarios de Estado (all federal secretariats)
- Subsecretarios de Estado
- Fiscal General de la República
- Titulares of decentralized/regulatory bodies
- Directors General of state-owned enterprises (Pemex, CFE, etc.)
- High-ranking military officers (generales de división, almirantes)

**Legislative Power:**

- Senadores (Senators)
- Diputados federales (Federal Deputies)
- All leadership positions in both chambers

**Judicial Power:**

- Suprema Corte de Justicia de la Nación (11 ministers)
- Consejo de la Judicatura Federal
- Tribunal Electoral del Poder Judicial de la Federación
- High-level magistrates and judges

**Autonomous Bodies:**

- Banco de México
- Instituto Nacional Electoral (INE)
- Comisión Nacional de los Derechos Humanos (CNDH)
- Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales (INAI)
- Other autonomous regulatory bodies

**State Enterprises:**

- Directors and up to 2 levels below in financial, human resources, and material resources areas
- Directors of public trusts and funds

### State Level (SECCIÓN II)

Homologous positions to federal level:

- Gobernadores (Governors)
- Secretarios estatales (State Secretaries)
- Diputados locales (State Deputies)
- Procuradores estatales (State Attorneys General)
- Magistrados estatales (State Magistrates)
- All equivalent positions at state level

### Municipal Level (SECCIÓN III)

Homologous positions to federal/state level:

- Presidentes Municipales (Municipal Presidents/Mayors)
- Regidores (Councilors)
- Síndicos (Municipal Attorneys)
- Secretarios municipales (Municipal Secretaries)
- Tesoreros municipales (Municipal Treasurers)
- All equivalent positions at municipal level

### Political Parties (SECCIÓN IV)

- Precandidatos (Pre-candidates)
- Candidatos (Candidates) for any public office
- Presidente Nacional de los Partidos Políticos
- Secretario General or equivalent
- Responsable Nacional de Finanzas
- Up to 2 levels below in financial, human resources, and material resources areas

## Hierarchical Rules

- **Three levels below**: For listed positions, also consider up to 3 hierarchical levels below, IF they have decision-making power
- **Two levels below**: For financial, human resources, and material resources areas, consider up to 2 levels below
- **Decision-making power**: Lower-level positions are PEP only if they have decision-making authority

## Risk Factors (Section E)

A person may be PEP even if not explicitly listed if they have "Prominent Functions" such as:

- Decision-making in public contracts/procurement
- Budget allocation/disposition
- Handling of reserved/confidential information
- Public finance management
- Granting authorizations, concessions, licenses
- Participation in audits and fiscal oversight
- General management with permanent decision-making authority

## Name Matching Rules

- **Exact or very close match required**: Name must match exactly or with minor variations (accents, surname order)
- **Partial matches are NOT sufficient**: Partial name coincidences should default to negative
- **Disambiguation required**: If ambiguous, return multiple candidates with `needs_disambiguation=true`

## Time Period

- Current positions: Always PEP
- Past positions: PEP if held within the last 5 years (until December 2025)
- Historical positions: Not PEP if more than 5 years ago

## Homologous Positions (Section F)

State and municipal positions that are homologous (same nature/structure) to federal positions listed in Annex 1 are also PEP, even if not explicitly enumerated.

## Evidence Requirements

- All asserted roles/claims must include evidence URLs
- Prefer primary/official sources (gob.mx, official portals)
- Include sources in `evidence` array and `search_audit.sources_consulted`
