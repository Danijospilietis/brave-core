// Copyright (c) 2023 The Brave Authors. All rights reserved.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

import { EntityId } from '@reduxjs/toolkit'

// types
import type WalletApiProxy from '../wallet_api_proxy'
import type { WalletPageApiProxy } from '../../page/wallet_page_api_proxy'
import type { WalletPanelApiProxy } from '../../panel/wallet_panel_api_proxy'

// constants
import {
  BraveWallet,
  SupportedCoinTypes,
  SupportedTestNetworks,
  SupportedOnRampNetworks,
  SupportedOffRampNetworks
} from '../../constants/types'

// entities
import {
  AccountInfoEntityState,
  AccountInfoEntity,
  accountInfoEntityAdaptor,
  accountInfoEntityAdaptorInitialState
} from '../slices/entities/account-info.entity'
import {
  BlockchainTokenEntityAdaptorState,
  blockchainTokenEntityAdaptor,
  blockchainTokenEntityAdaptorInitialState
} from '../slices/entities/blockchain-token.entity'
import {
  NetworksRegistry,
  networkEntityAdapter,
  emptyNetworksRegistry
} from '../slices/entities/network.entity'

// utils
import getAPIProxy from './bridge'
import { getAccountType } from '../../utils/account-utils'
import { addChainIdToToken, getAssetIdKey } from '../../utils/asset-utils'
import { addLogoToToken } from './lib'
import { makeNetworkAsset } from '../../options/asset-options'

/**
 * A function to return the ref to either the main api proxy, or a mocked proxy
 * @returns function that returns an ApiProxy instance
 */
export let apiProxyFetcher = () =>
  (getAPIProxy() as WalletApiProxy &
    Partial<WalletPanelApiProxy> &
    Partial<WalletPageApiProxy>)

/**
 * Assigns a function to use for fetching the walletApiProxy
 * (useful for injecting spies during testing)
 * @param fetcher A function to return the ref to either the main api proxy,
 *  or a mocked proxy
 */
export const setApiProxyFetcher = (fetcher: () => WalletApiProxy) => {
  apiProxyFetcher = fetcher
}

const accountInfoToAccountInfoEntity = (
  info: BraveWallet.AccountInfo
): AccountInfoEntity => {
  return {
    ...info,
    accountType: getAccountType(info),
    deviceId: info.hardware ? info.hardware.deviceId : ''
  }
}

/**
 * A place to store & manage dependency data for other queries
 */
export class BaseQueryCache {
  private _networksRegistry?: NetworksRegistry
  private _walletInfo?: BraveWallet.WalletInfo
  private _allAccountsInfo?: BraveWallet.AllAccountsInfo
  private _accountsRegistry?: AccountInfoEntityState
  private _selectedAccountAddress?: string | null
  private _userTokensRegistry?: BlockchainTokenEntityAdaptorState

  getWalletInfo = async () => {
    if (!this._walletInfo) {
      const { walletInfo } =
        await apiProxyFetcher().walletHandler.getWalletInfo()
      this._walletInfo = walletInfo
    }
    return this._walletInfo
  }

  getAllAccountsInfo = async () => {
    if (!this._allAccountsInfo) {
      const { allAccounts } =
        await apiProxyFetcher().keyringService.getAllAccounts()
      this._allAccountsInfo = allAccounts
    }
    return this._allAccountsInfo
  }

  getAccountsRegistry = async () => {
    if (!this._accountsRegistry) {
      const allAccounts = await this.getAllAccountsInfo()
      const accountInfos = allAccounts.accounts.map<AccountInfoEntity>(
        accountInfoToAccountInfoEntity
      )

      this._accountsRegistry = accountInfoEntityAdaptor.setAll(
        accountInfoEntityAdaptorInitialState,
        accountInfos
      )
    }
    return this._accountsRegistry
  }

  getSelectedAccountAddress = async () => {
    if (!this._selectedAccountAddress) {
      const { braveWalletService, keyringService } = apiProxyFetcher()
      const { coin: selectedCoin } = await braveWalletService.getSelectedCoin()

      if (selectedCoin === BraveWallet.CoinType.FIL) {
        const { chainId } = await braveWalletService.getChainIdForActiveOrigin(
          selectedCoin
        )
        const { address } = await keyringService.getFilecoinSelectedAccount(
          chainId
        )
        this._selectedAccountAddress = address
      } else {
        const { address } = await keyringService.getSelectedAccount(
          selectedCoin
        )
        this._selectedAccountAddress = address
      }
    }
    return this._selectedAccountAddress
  }

  clearWalletInfo = () => {
    this._walletInfo = undefined
    this._allAccountsInfo = undefined
    this._accountsRegistry = undefined
  }

  clearAccountsRegistry = () => {
    this.clearWalletInfo()
  }

  clearSelectedAccount = () => {
    this._selectedAccountAddress = undefined
  }

  getNetworksRegistry = async () => {
    if (!this._networksRegistry) {
      const { jsonRpcService } = apiProxyFetcher()

      // network type flags
      const { isFilecoinEnabled, isSolanaEnabled } = await this.getWalletInfo()

      // Get all networks
      const filteredSupportedCoinTypes = SupportedCoinTypes.filter((coin) => {
        // FIL and SOL networks, unless enabled by brave://flags
        return (
          (coin === BraveWallet.CoinType.FIL && isFilecoinEnabled) ||
          (coin === BraveWallet.CoinType.SOL && isSolanaEnabled) ||
          coin === BraveWallet.CoinType.ETH
        )
      })

      const visibleIds: string[] = []
      const hiddenIds: string[] = []
      const idsByCoinType: Record<EntityId, EntityId[]> = {}
      const hiddenIdsByCoinType: Record<EntityId, string[]> = {}
      const mainnetIds: string[] = []
      const onRampIds: string[] = []
      const offRampIds: string[] = []

      // Get all networks for supported coin types
      const networkLists: BraveWallet.NetworkInfo[][] = await Promise.all(
        filteredSupportedCoinTypes.map(async (coin: BraveWallet.CoinType) => {
          const { networks } = await jsonRpcService.getAllNetworks(coin)

          // hidden networks for coin
          let hiddenNetworkIds: string[] = []
          try {
            const { chainIds } = await jsonRpcService.getHiddenNetworks(coin)
            hiddenNetworkIds = chainIds.map(
              (id) =>
                networkEntityAdapter.selectId({
                  coin,
                  chainId: id
                }) as string
            )
          } catch (error) {
            console.log(error)
            console.log(
              `Unable to fetch Hidden ChainIds for coin: ${
                coin //
              }`
            )
            throw new Error(
              `Unable to fetch Hidden ChainIds for coin: ${
                coin //
              }`
            )
          }

          idsByCoinType[coin] = []
          hiddenIdsByCoinType[coin] = []

          networks.forEach(({ chainId, coin }) => {
            const networkId = networkEntityAdapter
              .selectId({
                chainId,
                coin
              })
              .toString()

            if (!SupportedTestNetworks.includes(chainId)) {
              // skip testnet & localhost chains
              mainnetIds.push(networkId)
            }

            if (hiddenNetworkIds.includes(networkId)) {
              hiddenIdsByCoinType[coin].push(networkId)
              hiddenIds.push(networkId)
            } else {
              // visible networks for coin
              idsByCoinType[coin].push(networkId)
              visibleIds.push(networkId)
            }

            // on-ramps
            if (SupportedOnRampNetworks.includes(chainId)) {
              onRampIds.push(networkId)
            }

            // off-ramps
            if (SupportedOffRampNetworks.includes(chainId)) {
              offRampIds.push(networkId)
            }
          })

          // all networks
          return networks
        })
      )

      const networksList = networkLists.flat(1)

      // normalize list into a registry
      const normalizedNetworksState = networkEntityAdapter.setAll(
        {
          ...emptyNetworksRegistry,
          idsByCoinType,
          hiddenIds,
          hiddenIdsByCoinType,
          visibleIds,
          onRampIds,
          offRampIds,
          mainnetIds
        },
        networksList
      )

      this._networksRegistry = normalizedNetworksState
    }
    return this._networksRegistry
  }

  clearNetworksRegistry = () => {
    this._networksRegistry = undefined
  }

  getUserTokensRegistry = async () => {
    if (!this._userTokensRegistry) {
      const { braveWalletService } = apiProxyFetcher()
      const networksRegistry = await this.getNetworksRegistry()

      const tokenIdsByChainId: Record<string, string[]> = {}
      const tokenIdsByCoinType: Record<BraveWallet.CoinType, string[]> = {}
      const visibleTokenIds: string[] = []
      const visibleTokenIdsByChainId: Record<string, string[]> = {}
      const visibleTokenIdsByCoinType: Record<BraveWallet.CoinType, string[]> =
        {}

      const userTokenListsForNetworks = await Promise.all(
        Object.entries(networksRegistry.entities).map(
          async ([networkId, network]) => {
            if (!network) {
              return []
            }

            const fullTokensListForNetwork: BraveWallet.BlockchainToken[] =
              await fetchUserAssetsForNetwork(braveWalletService, network)

            tokenIdsByChainId[networkId] =
              fullTokensListForNetwork.map(getAssetIdKey)

            tokenIdsByCoinType[network.coin] = (
              tokenIdsByCoinType[network.coin] || []
            ).concat(tokenIdsByChainId[networkId] || [])

            const visibleTokensForNetwork: BraveWallet.BlockchainToken[] =
              fullTokensListForNetwork.filter((t) => t.visible)

            visibleTokenIdsByChainId[networkId] =
              visibleTokensForNetwork.map(getAssetIdKey)

            visibleTokenIdsByCoinType[network.coin] = (
              visibleTokenIdsByCoinType[network.coin] || []
            ).concat(visibleTokenIdsByChainId[networkId] || [])

            visibleTokenIds.push(...visibleTokenIdsByChainId[networkId])

            return fullTokensListForNetwork
          }
        )
      )

      const userTokensByChainIdRegistry = blockchainTokenEntityAdaptor.setAll(
        {
          ...blockchainTokenEntityAdaptorInitialState,
          idsByChainId: tokenIdsByChainId,
          tokenIdsByChainId,
          visibleTokenIds,
          visibleTokenIdsByChainId,
          visibleTokenIdsByCoinType,
          idsByCoinType: tokenIdsByCoinType
        },
        userTokenListsForNetworks.flat(1)
      )

      this._userTokensRegistry = userTokensByChainIdRegistry
    }
    return this._userTokensRegistry
  }

  clearUserTokensRegistry = () => {
    this._userTokensRegistry = undefined
  }
}

let cache = new BaseQueryCache()

export const baseQueryFunction = () => {
  if (!cache) {
    cache = new BaseQueryCache()
  }
  return { data: apiProxyFetcher(), cache: cache }
}

export const resetCache = () => {
  cache = new BaseQueryCache()
}

// internals
async function fetchUserAssetsForNetwork(
  braveWalletService: BraveWallet.BraveWalletServiceRemote,
  network: BraveWallet.NetworkInfo
) {
  // Get a list of user tokens for each coinType and network.
  const { tokens } = await braveWalletService.getUserAssets(
    network.chainId,
    network.coin
  )

  // Adds a logo and chainId to each token object
  const tokenList: BraveWallet.BlockchainToken[] = await Promise.all(
    tokens.map(async (token) => {
      const updatedToken = await addLogoToToken(token)
      return addChainIdToToken(updatedToken, network.chainId)
    })
  )

  if (tokenList.length === 0) {
    // Creates a network's Native Asset if nothing was returned
    const nativeAsset = makeNetworkAsset(network)
    nativeAsset.logo = network.iconUrls[0] ?? ''
    nativeAsset.visible = false
    return [nativeAsset]
  }

  return tokenList
}
