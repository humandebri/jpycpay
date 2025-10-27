```markdown
# JPYC FiatTokenV1 (EIP-3009 / UUPS Proxy) — Developer Specification

**Network:** Polygon  
**Proxy Address:** `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`  
**Implementation (Logic):** `0xAFaC17fC3936A29ca2D2787CeD3C5D1C52007D2E`  
**Solidity Version:** 0.8.11  
**License:** MIT  

---

## 1. Architectural Overview

JPYC v2 is a **UUPS-style upgradeable fiat-backed ERC-20** implementing both  
[EIP-3009 (Transfer With Authorization)](https://eips.ethereum.org/EIPS/eip-3009)  
and [EIP-2612 (Permit)](https://eips.ethereum.org/EIPS/eip-2612).

```

```
    ┌──────────────────────────┐
    │  External callers (dApp) │
    └──────────────┬───────────┘
                   │ call
                   ▼
    ┌──────────────────────────┐
    │  Proxy                   │  ← stores all balances, allowances
    │  (EIP-1967 slot storage) │
    └──────────────┬───────────┘
         delegatecall
                   ▼
    ┌──────────────────────────┐
    │  Implementation (logic)  │  ← FiatTokenV1 / EIP-3009 / UUPS
    └──────────────────────────┘
```

````

### Important Rule
> All on-chain interactions **must target the Proxy address**.  
> The Implementation contract should **never** be called directly.

---

## 2. Why Only the Proxy Is Used

| Layer | Purpose | Holds State? | Should Be Called Directly? |
|-------|----------|--------------|-----------------------------|
| **Proxy (`0xE7C3…`)** | Entry point for users / dApps | ✅ Yes | ✅ Yes |
| **Implementation (`0xAFaC…`)** | Business logic only | ❌ No | ❌ No |

### Reasons
1. **Storage lives in the Proxy.**  
   Direct calls to Implementation see all storage (`balances`, `allowances`) as zero.
2. **Access control assumes delegatecall.**  
   Functions like `onlyOwner`, `onlyProxy` rely on `msg.sender` being the Proxy.
3. **Upgrade safety.**  
   `UUPSUpgradeable` reverts when called outside a delegatecall context.

### Mental model
> Proxy = “body” (state & address)  
> Implementation = “brain” (logic)  
> Transactions must go through the body for the brain to act.

---

## 3. Core Standards Implemented

| Feature | Standard | Purpose |
|----------|-----------|---------|
| ERC-20 | EIP-20 | Basic token logic |
| Meta-Tx | EIP-3009 | Gasless transfer via signed authorization |
| Permit | EIP-2612 | Signed allowance updates |
| Proxy | EIP-1967 + UUPS (EIP-1822) | Upgradeable design |
| Domain | EIP-712 | Typed structured data for signatures |

---

## 4. Initialization

```solidity
function initialize(
  string memory tokenName,
  string memory tokenSymbol,
  string memory tokenCurrency,
  uint8 tokenDecimals,
  address newMinterAdmin,
  address newPauser,
  address newBlocklister,
  address newRescuer,
  address newOwner
)
````

* Callable **once** on deployment (protected by `initializedVersion == 0`)
* Establishes administrative roles and EIP-712 domain separator

---

## 5. Minting & Burning

| Function                           | Role            | Notes                     |
| ---------------------------------- | --------------- | ------------------------- |
| `configureMinter(address,uint256)` | onlyMinterAdmin | Assign minter & limit     |
| `mint(address,uint256)`            | onlyMinters     | Must not exceed allowance |
| `burn(uint256)`                    | onlyMinters     | Reduces total supply      |
| `removeMinter(address)`            | onlyMinterAdmin | Revokes rights            |

---

## 6. EIP-3009 Meta-Transaction Interface

### Type Hashes

```solidity
TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
  keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

CANCEL_AUTHORIZATION_TYPEHASH =
  keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");
```

### Public Methods

```solidity
function transferWithAuthorization(
  address from,
  address to,
  uint256 value,
  uint256 validAfter,
  uint256 validBefore,
  bytes32 nonce,
  uint8 v, bytes32 r, bytes32 s
) external;
```

```solidity
function receiveWithAuthorization(
  address from,
  address to,
  uint256 value,
  uint256 validAfter,
  uint256 validBefore,
  bytes32 nonce,
  uint8 v, bytes32 r, bytes32 s
) external;
```

```solidity
function cancelAuthorization(
  address authorizer,
  bytes32 nonce,
  uint8 v, bytes32 r, bytes32 s
) external;
```

### State Tracking

```solidity
function authorizationState(address authorizer, bytes32 nonce)
  external view returns (bool);
```

* Nonce used = `true`
* Prevents replay attacks
* `validAfter` / `validBefore` control time-window validity

---

## 7. EIP-2612 Permit (Signature Approvals)

```solidity
function permit(
  address owner,
  address spender,
  uint256 value,
  uint256 deadline,
  uint8 v, bytes32 r, bytes32 s
) external;
```

Gasless approval for ERC-20 spenders.

---

## 8. Upgradeability (UUPS / EIP-1967)

| Storage Slot           | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| `_IMPLEMENTATION_SLOT` | `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` |

Upgrade is restricted to the owner via:

```solidity
function _authorizeUpgrade(address newImplementation)
  internal override onlyOwner {}
```

Upgrades are performed by calling `upgradeTo()` **on the Proxy**,
which delegatecalls `_upgradeToAndCallUUPS()` inside the logic contract.

---

## 9. Security Layers

| Module                           | Purpose                                                |
| -------------------------------- | ------------------------------------------------------ |
| **Pausable**                     | Emergency freeze                                       |
| **Blocklistable**                | AML/KYC enforcement                                    |
| **Rescuable**                    | Owner can recover stuck assets                         |
| **EIP-712 domain**               | Dynamic chain-id detection to avoid cross-chain replay |
| **onlyOwner / onlyProxy guards** | Prevents direct logic calls & hijacking                |

---

## 10. Developer Integration Notes

### Always call via Proxy

```js
import { ethers } from "ethers";
const token = new ethers.Contract(
  "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", // Proxy
  abi,
  signer
);

await token.transferFrom(from, to, amount);
```

### Never call the Implementation

```js
// ❌ Will revert or read zero state
const impl = new ethers.Contract(
  "0xAFaC17fC3936A29ca2D2787CeD3C5D1C52007D2E",
  abi,
  signer
);
await impl.transferFrom(from, to, amount); // unsafe
```

### Checking the current logic address

Using Foundry:

```bash
cast storage 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 \
0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
--rpc-url https://polygon-rpc.com
```

Returns current implementation (`0xAFaC17fC3936A29ca2D2787CeD3C5D1C52007D2E`).

---

## 11. Example: Gasless Transfer Flow (EIP-3009)

1. Off-chain:

   * Construct `TransferWithAuthorization` message
   * Sign using EIP-712 (domain = JPYC)
2. Backend or relayer:

   * Calls `transferWithAuthorization()` on the Proxy
3. Proxy delegates → FiatTokenV1 logic executes transfer
4. Tokens move, sender pays **zero gas**

Ideal for x402 or machine-native micropayments.

---

## 12. Function Selectors (useful for tooling)

| Function                    | Selector     |
| --------------------------- | ------------ |
| `transferWithAuthorization` | `0x7d64bcb4` |
| `receiveWithAuthorization`  | `0x2e6f7b38` |
| `cancelAuthorization`       | `0x54b76031` |
| `permit`                    | `0xd505accf` |
| `upgradeTo(address)`        | `0x3659cfe6` |

---

