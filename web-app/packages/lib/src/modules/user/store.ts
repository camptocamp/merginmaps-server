// Copyright (C) Lutra Consulting Limited
//
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MerginMaps-Commercial

import isObject from 'lodash/isObject'
import { defineStore } from 'pinia'
import Cookies from 'universal-cookie'
// import { isNavigationFailure, NavigationFailureType } from 'vue-router'
import { Module } from 'vuex'

import { UserModule } from './module'

import { waitCursor } from '@/common/html_utils'
import { isAtLeastRole, UserRole } from '@/common/permission_utils'
import { useDialogStore } from '@/modules/dialog/store'
import { useFormStore } from '@/modules/form/store'
import { useInstanceStore } from '@/modules/instance/store'
import { useNotificationStore } from '@/modules/notification/store'
import { useProjectStore } from '@/modules/project/store'
import { RootState } from '@/modules/types'
import {
  ResetPasswordPayload,
  ChangePasswordWithTokenPayload,
  ChangePasswordPayload,
  IsWorkspaceAdminPayload,
  LoginPayload,
  UserDetailResponse,
  WorkspaceIdPayload,
  WorkspaceResponse,
  SetWorkspaceIdPayload
} from '@/modules/user/types'
import { UserApi } from '@/modules/user/userApi'

export interface UserState {
  loggedUser?: UserDetailResponse
  workspaces: WorkspaceResponse[]
  workspaceId: number
}

const cookies = new Cookies()
const COOKIES_CURRENT_WORKSPACE = 'currentWorkspace'

export const useUserStore = defineStore('userModule', {
  state: (): UserState => ({
    loggedUser: null,
    workspaces: [],
    workspaceId: undefined
  }),

  getters: {
    isLoggedIn: (state) => {
      const instanceStore = useInstanceStore()
      return (
        instanceStore.initData?.authenticated ||
        state.loggedUser?.username != null
      )
    },
    isSuperUser() {
      const instanceStore = useInstanceStore()
      return this.isLoggedIn && instanceStore.initData?.superuser
    },
    isGlobalWorkspaceAdmin() {
      return isAtLeastRole(this.getPreferredWorkspace?.role, UserRole.admin)
    },
    getPreferredWorkspace: (state) => {
      return (
        state.loggedUser?.workspaces &&
        state.loggedUser?.workspaces.find(
          (workspace) => workspace.id === state.loggedUser.preferred_workspace
        )
      )
    },
    getUserFullName: (state) => {
      return state.loggedUser?.name && state.loggedUser?.name !== ''
        ? state.loggedUser.name
        : state.loggedUser?.username
        ? state.loggedUser.username
        : ''
    },
    isWorkspaceAdmin() {
      return (payload?: IsWorkspaceAdminPayload): boolean => {
        const workspace = payload?.id
          ? this.getWorkspaceById({ id: payload.id })
          : this.currentWorkspace
        return isAtLeastRole(workspace?.role, UserRole.admin)
      }
    },
    isWorkspaceOwner() {
      return (payload?: IsWorkspaceAdminPayload): boolean => {
        const workspace = payload?.id
          ? this.getWorkspaceById({ id: payload.id })
          : this.currentWorkspace
        return isAtLeastRole(workspace?.role, UserRole.owner)
      }
    },
    currentWorkspace: (state) => {
      return state.workspaces.find(
        (workspace) => workspace.id === state.workspaceId
      )
    },
    getWorkspaceById(state) {
      return (payload: WorkspaceIdPayload) => {
        return state.workspaces.find((workspace) => workspace.id === payload.id)
      }
    },
    getWorkspaceByName(state) {
      return (payload) => {
        return state.workspaces.find(
          (workspace) => workspace.name === payload.name
        )
      }
    }
  },

  actions: {
    updateLoggedUser(payload) {
      this.loggedUser = payload.loggedUser
    },

    updateVerifiedEmail(payload) {
      this.loggedUser.verified_email = payload.verifiedEmail
    },

    setWorkspaces(payload) {
      this.workspaces = payload.workspaces
    },

    setWorkspaceId(payload) {
      this.workspaceId = payload.id
    },

    async editUserProfile(payload) {
      const dialogStore = useDialogStore()
      const notificationStore = useNotificationStore()
      const formStore = useFormStore()

      waitCursor(true)
      try {
        await UserApi.editUserProfile(payload.editedUser, true)
        dialogStore.close()
        this.updateLoggedUser({
          loggedUser: payload.editedUser
        })
        await this.fetchUserProfile()
        await notificationStore.show({ text: 'Profile has been changed' })
      } catch (error) {
        await formStore.handleError({
          componentId: payload.componentId,
          error,
          generalMessage: 'Failed to change profile'
        })
      } finally {
        waitCursor(false)
      }
    },

    async fetchUserProfile() {
      const projectStore = useProjectStore()
      const notificationStore = useNotificationStore()

      let resp
      try {
        resp = await UserApi.fetchUserProfile()
        this.updateLoggedUser({ loggedUser: resp.data })
        this.updateVerifiedEmail({
          verifiedEmail: resp.data.verified_email
        })
        if (!projectStore.currentNamespace) {
          // set current namespace only if not set
          const preferredWorkspace = this.getPreferredWorkspace
          if (preferredWorkspace?.name) {
            projectStore.setCurrentNamespace({
              currentNamespace: preferredWorkspace.name
            })
          }
        }
      } catch {
        await notificationStore.error({
          text: "Failed to fetch user's profile"
        })
      }
      return resp?.data
    },

    async closeUserProfile() {
      const notificationStore = useNotificationStore()

      waitCursor(true)
      try {
        await UserApi.closeUserProfile(true)
        this.updateLoggedUser({
          loggedUser: null
        })
        // taken from logout action, router would return error because user is considered as logged in
        location.href = '/'
      } catch (err) {
        const msg =
          err.response && err.response.data.detail
            ? err.response.data.detail
            : 'Unable to close account'
        await notificationStore.error({
          text: msg
        })
      } finally {
        waitCursor(false)
      }
    },

    async redirectAfterLogin(payload) {
      const notificationStore = useNotificationStore()

      try {
        UserModule.routerService
          .push(payload.currentRoute.query.redirect)
          // TODO: V3_UPGRADE - probably not needed anymore in vue-router v4 - check needed
          .catch((e) => {
            //   if (!isNavigationFailure(e, NavigationFailureType.redirected)) {
            Promise.reject(e)
            //   }
          })
      } catch (e) {
        // TODO: V3_UPGRADE - probably not needed anymore in vue-router v4 - check needed
        // if (isNavigationFailure(e, NavigationFailureType.redirected)) {
        //   // expected redirect
        //   //   https://router.vuejs.org/guide/advanced/navigation-failures.html#detecting-navigation-failures
        // } else {
        await notificationStore.error({
          text: e
        })
        // }
      }
    },

    async redirectFromLoginAfterLogin(payload) {
      if (payload.currentRoute.path === '/login') {
        UserModule.routerService.push({ path: '/' }).catch((e) => {
          // TODO: V3_UPGRADE - probably not needed anymore in vue-router v4 - check needed
          // if (!isNavigationFailure(e, NavigationFailureType.redirected)) {
          Promise.reject(e)
          // }
        })
      }
    },

    async userLogin(payload: LoginPayload) {
      const instanceStore = useInstanceStore()
      const formStore = useFormStore()

      try {
        await UserApi.login(payload.data)
        await instanceStore.initApp()
      } catch (error) {
        await formStore.handleError({
          componentId: payload.componentId,
          error,
          generalMessage: 'Failed to login'
        })
      }
    },

    async resetPassword(payload: ResetPasswordPayload) {
      const notificationStore = useNotificationStore()
      const formStore = useFormStore()

      try {
        await UserApi.resetPassword({ email: payload.email })
        await UserModule.routerService.push({ path: '/login' })
        await notificationStore.show({
          text: 'Email with password reset link was sent to your email address',
          timeout: 3000
        })
      } catch (error) {
        await formStore.handleError({
          componentId: payload.componentId,
          error,
          generalMessage: 'Failed to send confirmation email'
        })
      }
    },

    async changePasswordWithToken(payload: ChangePasswordWithTokenPayload) {
      const formStore = useFormStore()

      waitCursor(true)
      try {
        await UserApi.changePasswordWithToken(payload.token, payload.data, true)
        // callback - set => this.success = true
        payload.callback(true)
        waitCursor(false)
      } catch (e) {
        waitCursor(false)
        // callback - set => this.success = false
        payload.callback(false)
        await formStore.handleError({
          componentId: payload.componentId,
          error: e,
          generalMessage: 'Failed to change password'
        })
      }
    },

    async resendConfirmationEmail(payload) {
      const notificationStore = useNotificationStore()

      try {
        await UserApi.resendEmail()
        await notificationStore.show({
          text: `Email was sent to address: ${payload.email}`
        })
      } catch (err) {
        await notificationStore.error({
          text: 'Failed to send confirmation email, please check your address in user profile settings'
        })
      }
    },

    async changePassword(payload: ChangePasswordPayload) {
      const notificationStore = useNotificationStore()
      const formStore = useFormStore()
      const dialogStore = useDialogStore()

      waitCursor(true)
      try {
        await UserApi.changePassword(payload.data, true)
        dialogStore.close()
        await notificationStore.show({ text: 'Password has been changed' })
      } catch (error) {
        await formStore.handleError({
          componentId: payload.componentId,
          error,
          generalMessage: 'Failed to change password'
        })
      } finally {
        waitCursor(false)
      }
    },

    clearUserData() {
      const projectStore = useProjectStore()

      projectStore.clearProjects()
      this.updateLoggedUser({ loggedUser: null })
    },

    async getWorkspace(payload) {
      const notificationStore = useNotificationStore()

      let newWorkspace
      try {
        const workspaceResponse = await UserApi.getWorkspaceById(payload.id)
        newWorkspace = workspaceResponse.data
        this.setWorkspaceId({ id: payload.id })
        await this.updateWorkspacesWithWorkspaceChange({
          workspace: newWorkspace
        })
      } catch (_err) {
        await notificationStore.error({
          text: 'Failed to load workspace'
        })
      }
      return newWorkspace
    },

    async getWorkspaces() {
      const notificationStore = useNotificationStore()

      let workspacesResponse
      try {
        workspacesResponse = await UserApi.getWorkspaces()
        this.setWorkspaces({ workspaces: workspacesResponse.data })
      } catch (_err) {
        await notificationStore.error({
          text: 'Failed to load workspaces'
        })
      }
      return workspacesResponse
    },

    async updateWorkspacesWithWorkspaceChange(payload) {
      // update this.workspaces
      if (this.workspaces) {
        const idx = this.workspaces.findIndex(
          (workspace) => workspace.id === payload.workspace.id
        )
        if (idx !== -1) {
          this.setWorkspaces({
            workspaces: [
              ...this.workspaces.slice(0, idx),
              payload.workspace,
              ...this.workspaces.slice(idx + 1)
            ]
          })
        }
      }
    },

    async getPreferredWorkspaceId() {
      let preferredWorkspaceId
      try {
        const userProfileResponse = await this.fetchUserProfile()
        preferredWorkspaceId = userProfileResponse.preferred_workspace
      } catch (err) {
        console.warn('Failed to get preferred workspace id', err)
      }
      return preferredWorkspaceId
    },

    async setWorkspace(payload: SetWorkspaceIdPayload) {
      const projectStore = useProjectStore()

      if (this.workspaceId === payload.workspaceId) {
        return
      }
      // 'setWorkspaceId' and 'projectModule/setCurrentNamespace' has to be called together synchronously.
      // In case when there is some async call between their calls, the watchers can be updated incorrectly
      this.setWorkspaceId({ id: payload.workspaceId })
      if (this.currentWorkspace) {
        projectStore.setCurrentNamespace({
          currentNamespace: this.currentWorkspace.name
        })
      }
      if (!payload.skipSavingInCookies) {
        return await this.setUserWorkspaceToCookies({
          id: payload.workspaceId
        })
      }
    },

    async getAllUserWorkspacesFromCookies() {
      let value: Record<string, string>
      try {
        const cookieValue = cookies.get(COOKIES_CURRENT_WORKSPACE, {
          doNotParse: true
        })
        if (cookieValue) {
          const parsedValue = JSON.parse(cookieValue)
          if (isObject(parsedValue)) {
            value = parsedValue
          } else {
            console.warn(
              `Stored cookies (${COOKIES_CURRENT_WORKSPACE}) value is not an object, removing it.`
            )
            // stored cookies value has deprecated format
            cookies.remove(COOKIES_CURRENT_WORKSPACE)
          }
        }
      } catch (e) {
        console.warn(
          `Stored cookies (${COOKIES_CURRENT_WORKSPACE}) value is malformed, removing it.`,
          e
        )
        // stored cookies value is malformed, remove it
        cookies.remove(COOKIES_CURRENT_WORKSPACE)
      }
      return value
    },

    async getUserWorkspaceFromCookies() {
      let userWorkspaceId: string
      if (this.loggedUser?.username) {
        try {
          const value = await this.getAllUserWorkspacesFromCookies()
          if (value) {
            userWorkspaceId = value[this.loggedUser?.username]
          }
        } catch {
          // ignore
        }
      }
      return userWorkspaceId
    },

    async removeUserWorkspaceFromCookies() {
      const projectStore = useProjectStore()

      if (this.loggedUser?.username) {
        let value: Record<string, string>
        try {
          value = await this.getAllUserWorkspacesFromCookies()
        } catch {
          // ignore
        }

        delete value[this.loggedUser?.username]
        const strValue = JSON.stringify(value)

        const expires = new Date()
        // cookies expire in one year
        expires.setFullYear(expires.getFullYear() + 1)
        cookies.set(COOKIES_CURRENT_WORKSPACE, strValue, {
          expires
        })
      }
      await projectStore.setCurrentNamespace({
        currentNamespace: ''
      })
    },

    async setUserWorkspaceToCookies(payload) {
      if (this.loggedUser?.username) {
        let oldValue: Record<string, string>
        try {
          oldValue = await this.getAllUserWorkspacesFromCookies()
        } catch {
          // ignore
        }

        const value = JSON.stringify({
          ...oldValue,
          [this.loggedUser?.username]: payload.id
        })
        const expires = new Date()
        // cookies expire in one year
        expires.setFullYear(expires.getFullYear() + 1)
        cookies.set(COOKIES_CURRENT_WORKSPACE, value, {
          expires
        })
      }
    },

    async setFirstWorkspace() {
      if (this.workspaces.length > 0) {
        await this.setWorkspace({
          workspaceId: this.workspaces[0].id
        })
      }
    },

    async checkCurrentWorkspace() {
      try {
        await this.getWorkspaces()
        const currentWorkspaceFromCookie =
          await this.getUserWorkspaceFromCookies()
        if (this.workspaces.length > 0) {
          let foundWorkspace
          let skipSavingInCookies = true
          if (currentWorkspaceFromCookie !== undefined) {
            // try to use workspace stored in cookies
            foundWorkspace = this.getWorkspaceById({
              id: parseInt(currentWorkspaceFromCookie)
            })
          }
          if (!foundWorkspace) {
            // try to use preferred_workspace from user profile response
            const preferredWorkspaceId = await this.getPreferredWorkspaceId()
            if (preferredWorkspaceId) {
              foundWorkspace = this.getWorkspaceById({
                id: preferredWorkspaceId
              })
              if (foundWorkspace?.id) {
                // do not skip saving in cookies when using preferredWorkspace
                skipSavingInCookies = false
              }
            }
          }
          // use id from found workspace, if not found fallback to first workspace from user workspaces
          const currentWorkspaceIdToSet =
            foundWorkspace?.id ?? this.workspaces[0].id
          await this.setWorkspace({
            workspaceId: currentWorkspaceIdToSet,
            // do not save workspaceId to cookies as it could be:
            // * already there, if was loaded from cookies
            // * used the first user workspace as fallback, then it is not a user choice
            skipSavingInCookies
          })
        } else {
          await this.removeUserWorkspaceFromCookies()
        }
      } catch (e) {
        console.warn('Loading of stored user workspace id has failed.', e)
      }
    }
  }
})

const UserStore: Module<UserState, RootState> = {
  namespaced: true,
  state: {
    loggedUser: null,
    workspaces: [],
    workspaceId: undefined
  },

  getters: {
    isLoggedIn: (state, getters, rootState) =>
      rootState.instanceModule.initData?.authenticated ||
      state.loggedUser?.username != null,
    isSuperUser: (state, getters, rootState) => {
      return getters.isLoggedIn && rootState.instanceModule.initData?.superuser
    },
    isGlobalWorkspaceAdmin: (state, getters) => {
      return isAtLeastRole(getters.getPreferredWorkspace?.role, UserRole.admin)
    },
    getPreferredWorkspace: (state) => {
      return (
        state.loggedUser?.workspaces &&
        state.loggedUser?.workspaces.find(
          (workspace) => workspace.id === state.loggedUser.preferred_workspace
        )
      )
    },
    getUserFullName: (state) => {
      return state.loggedUser?.name && state.loggedUser?.name !== ''
        ? state.loggedUser.name
        : state.loggedUser?.username
        ? state.loggedUser.username
        : ''
    },
    isWorkspaceAdmin:
      (state, getters) =>
      (payload?: IsWorkspaceAdminPayload): boolean => {
        const workspace = payload?.id
          ? getters.getWorkspaceById({ id: payload.id })
          : getters.currentWorkspace
        return isAtLeastRole(workspace?.role, UserRole.admin)
      },
    isWorkspaceOwner:
      (state, getters) =>
      (payload?: IsWorkspaceAdminPayload): boolean => {
        const workspace = payload?.id
          ? getters.getWorkspaceById({ id: payload.id })
          : getters.currentWorkspace
        return isAtLeastRole(workspace?.role, UserRole.owner)
      },
    currentWorkspace: (state) => {
      return state.workspaces.find(
        (workspace) => workspace.id === state.workspaceId
      )
    },
    getWorkspaceById: (state) => (payload: WorkspaceIdPayload) => {
      return state.workspaces.find((workspace) => workspace.id === payload.id)
    },
    getWorkspaceByName: (state) => (payload) => {
      return state.workspaces.find(
        (workspace) => workspace.name === payload.name
      )
    }
  },

  mutations: {
    updateLoggedUser(state, payload) {
      state.loggedUser = payload.loggedUser
    },
    updateVerifiedEmail(state, payload) {
      state.loggedUser.verified_email = payload.verifiedEmail
    },
    setWorkspaces(state, payload) {
      state.workspaces = payload.workspaces
    },
    setWorkspaceId(state, payload) {
      state.workspaceId = payload.id
    }
  },
  actions: {
    async editUserProfile({ commit, dispatch }, payload) {
      waitCursor(true)
      try {
        await UserApi.editUserProfile(payload.editedUser, true)
        dispatch('dialogModule/close', undefined, { root: true })
        commit('updateLoggedUser', {
          loggedUser: payload.editedUser
        })
        await dispatch('fetchUserProfile')
        await dispatch(
          'notificationModule/show',
          { text: 'Profile has been changed' },
          { root: true }
        )
      } catch (error) {
        await dispatch(
          'formModule/handleError',
          {
            componentId: payload.componentId,
            error,
            generalMessage: 'Failed to change profile'
          },
          { root: true }
        )
      } finally {
        waitCursor(false)
      }
    },
    async fetchUserProfile({ commit, dispatch, getters, rootState }) {
      let resp
      try {
        resp = await UserApi.fetchUserProfile()
        commit('updateLoggedUser', { loggedUser: resp.data })
        commit('updateVerifiedEmail', {
          verifiedEmail: resp.data.verified_email
        })
        if (!rootState.projectModule.currentNamespace) {
          // set current namespace only if not set
          const preferredWorkspace = getters.getPreferredWorkspace
          if (preferredWorkspace?.name) {
            commit(
              'projectModule/setCurrentNamespace',
              {
                currentNamespace: preferredWorkspace.name
              },
              {
                root: true
              }
            )
          }
        }
      } catch {
        await dispatch(
          'notificationModule/error',
          { text: "Failed to fetch user's profile" },
          {
            root: true
          }
        )
      }
      return resp?.data
    },

    async closeUserProfile({ commit, dispatch }) {
      waitCursor(true)
      try {
        await UserApi.closeUserProfile(true)
        commit('updateLoggedUser', {
          loggedUser: null
        })
        // taken from logout action, router would return error because user is considered as logged in
        location.href = '/'
      } catch (err) {
        const msg =
          err.response && err.response.data.detail
            ? err.response.data.detail
            : 'Unable to close account'
        await dispatch(
          'notificationModule/error',
          {
            text: msg
          },
          {
            root: true
          }
        )
      } finally {
        waitCursor(false)
      }
    },

    async redirectAfterLogin({ dispatch }, payload) {
      try {
        UserModule.routerService
          .push(payload.currentRoute.query.redirect)
          // TODO: V3_UPGRADE - probably not needed anymore in vue-router v4 - check needed
          .catch((e) => {
            //   if (!isNavigationFailure(e, NavigationFailureType.redirected)) {
            Promise.reject(e)
            //   }
          })
      } catch (e) {
        // TODO: V3_UPGRADE - probably not needed anymore in vue-router v4 - check needed
        // if (isNavigationFailure(e, NavigationFailureType.redirected)) {
        //   // expected redirect
        //   //   https://router.vuejs.org/guide/advanced/navigation-failures.html#detecting-navigation-failures
        // } else {
        await dispatch(
          'notificationModule/error',
          {
            text: e
          },
          {
            root: true
          }
        )
        // }
      }
    },

    async redirectFromLoginAfterLogin(_, payload) {
      if (payload.currentRoute.path === '/login') {
        UserModule.routerService.push({ path: '/' }).catch((e) => {
          // TODO: V3_UPGRADE - probably not needed anymore in vue-router v4 - check needed
          // if (!isNavigationFailure(e, NavigationFailureType.redirected)) {
          Promise.reject(e)
          // }
        })
      }
    },

    async userLogin({ dispatch }, payload: LoginPayload) {
      try {
        await UserApi.login(payload.data)
        await dispatch('instanceModule/initApp', undefined, { root: true })
      } catch (error) {
        await dispatch(
          'formModule/handleError',
          {
            componentId: payload.componentId,
            error,
            generalMessage: 'Failed to login'
          },
          { root: true }
        )
      }
    },
    async resetPassword({ dispatch }, payload: ResetPasswordPayload) {
      try {
        await UserApi.resetPassword({ email: payload.email })
        await UserModule.routerService.push({ path: '/login' })
        await dispatch(
          'notificationModule/show',
          {
            text: 'Email with password reset link was sent to your email address',
            timeout: 3000
          },
          {
            root: true
          }
        )
      } catch (error) {
        await dispatch(
          'formModule/handleError',
          {
            componentId: payload.componentId,
            error,
            generalMessage: 'Failed to send confirmation email'
          },
          { root: true }
        )
      }
    },
    async changePasswordWithToken(
      { dispatch },
      payload: ChangePasswordWithTokenPayload
    ) {
      waitCursor(true)
      try {
        await UserApi.changePasswordWithToken(payload.token, payload.data, true)
        // callback - set => this.success = true
        payload.callback(true)
        waitCursor(false)
      } catch (e) {
        waitCursor(false)
        // callback - set => this.success = false
        payload.callback(false)
        await dispatch(
          'formModule/handleError',
          {
            componentId: payload.componentId,
            error: e,
            generalMessage: 'Failed to change password'
          },
          { root: true }
        )
      }
    },
    async resendConfirmationEmail({ dispatch }, payload) {
      try {
        await UserApi.resendEmail()
        await dispatch(
          'notificationModule/show',
          {
            text: `Email was sent to address: ${payload.email}`
          },
          {
            root: true
          }
        )
      } catch (err) {
        await dispatch(
          'notificationModule/error',
          {
            text: 'Failed to send confirmation email, please check your address in user profile settings'
          },
          {
            root: true
          }
        )
      }
    },
    async changePassword({ dispatch }, payload: ChangePasswordPayload) {
      waitCursor(true)
      try {
        await UserApi.changePassword(payload.data, true)
        dispatch('dialogModule/close', undefined, { root: true })
        await dispatch(
          'notificationModule/show',
          { text: 'Password has been changed' },
          { root: true }
        )
      } catch (error) {
        await dispatch(
          'formModule/handleError',
          {
            componentId: payload.componentId,
            error,
            generalMessage: 'Failed to change password'
          },
          { root: true }
        )
      } finally {
        waitCursor(false)
      }
    },
    clearUserData({ commit, dispatch }) {
      dispatch('projectModule/clearProjects', undefined, { root: true })
      commit('updateLoggedUser', { loggedUser: null })
    },
    async getWorkspace({ commit, dispatch }, payload) {
      let newWorkspace
      try {
        const workspaceResponse = await UserApi.getWorkspaceById(payload.id)
        newWorkspace = workspaceResponse.data
        commit('setWorkspaceId', { id: payload.id })
        await dispatch('updateWorkspacesWithWorkspaceChange', {
          workspace: newWorkspace
        })
      } catch (_err) {
        await dispatch(
          'notificationModule/error',
          {
            text: 'Failed to load workspace'
          },
          { root: true }
        )
      }
      return newWorkspace
    },

    async getWorkspaces({ commit, dispatch }) {
      let workspacesResponse
      try {
        workspacesResponse = await UserApi.getWorkspaces()
        commit('setWorkspaces', { workspaces: workspacesResponse.data })
      } catch (_err) {
        await dispatch(
          'notificationModule/error',
          {
            text: 'Failed to load workspaces'
          },
          { root: true }
        )
      }
      return workspacesResponse
    },

    async updateWorkspacesWithWorkspaceChange({ commit, state }, payload) {
      // update state.workspaces
      if (state.workspaces) {
        const idx = state.workspaces.findIndex(
          (workspace) => workspace.id === payload.workspace.id
        )
        if (idx !== -1) {
          commit('setWorkspaces', {
            workspaces: [
              ...state.workspaces.slice(0, idx),
              payload.workspace,
              ...state.workspaces.slice(idx + 1)
            ]
          })
        }
      }
    },

    async getPreferredWorkspaceId({ dispatch }) {
      let preferredWorkspaceId
      try {
        const userProfileResponse = await dispatch('fetchUserProfile')
        preferredWorkspaceId = userProfileResponse.preferred_workspace
      } catch (err) {
        console.warn('Failed to get preferred workspace id', err)
      }
      return preferredWorkspaceId
    },

    async setWorkspace(
      { commit, dispatch, state, getters },
      payload: SetWorkspaceIdPayload
    ) {
      if (state.workspaceId === payload.workspaceId) {
        return
      }
      // 'setWorkspaceId' and 'projectModule/setCurrentNamespace' has to be called together synchronously.
      // In case when there is some async call between their calls, the watchers can be updated incorrectly
      commit('setWorkspaceId', { id: payload.workspaceId })
      if (getters.currentWorkspace) {
        commit(
          'projectModule/setCurrentNamespace',
          { currentNamespace: getters.currentWorkspace.name },
          { root: true }
        )
      }
      if (!payload.skipSavingInCookies) {
        return await dispatch('setUserWorkspaceToCookies', {
          id: payload.workspaceId
        })
      }
    },

    async getAllUserWorkspacesFromCookies() {
      let value: Record<string, string>
      try {
        const cookieValue = cookies.get(COOKIES_CURRENT_WORKSPACE, {
          doNotParse: true
        })
        if (cookieValue) {
          const parsedValue = JSON.parse(cookieValue)
          if (isObject(parsedValue)) {
            value = parsedValue
          } else {
            console.warn(
              `Stored cookies (${COOKIES_CURRENT_WORKSPACE}) value is not an object, removing it.`
            )
            // stored cookies value has deprecated format
            cookies.remove(COOKIES_CURRENT_WORKSPACE)
          }
        }
      } catch (e) {
        console.warn(
          `Stored cookies (${COOKIES_CURRENT_WORKSPACE}) value is malformed, removing it.`,
          e
        )
        // stored cookies value is malformed, remove it
        cookies.remove(COOKIES_CURRENT_WORKSPACE)
      }
      return value
    },

    async getUserWorkspaceFromCookies({ dispatch, state }) {
      let userWorkspaceId: string
      if (state.loggedUser?.username) {
        try {
          const value = await dispatch('getAllUserWorkspacesFromCookies')
          if (value) {
            userWorkspaceId = value[state.loggedUser?.username]
          }
        } catch {
          // ignore
        }
      }
      return userWorkspaceId
    },

    async removeUserWorkspaceFromCookies({ commit, dispatch, state }) {
      if (state.loggedUser?.username) {
        let value: Record<string, string>
        try {
          value = await dispatch('getAllUserWorkspacesFromCookies')
        } catch {
          // ignore
        }

        delete value[state.loggedUser?.username]
        const strValue = JSON.stringify(value)

        const expires = new Date()
        // cookies expire in one year
        expires.setFullYear(expires.getFullYear() + 1)
        cookies.set(COOKIES_CURRENT_WORKSPACE, strValue, {
          expires
        })
      }
      await commit(
        'projectModule/setCurrentNamespace',
        {
          currentNamespace: ''
        },
        { root: true }
      )
    },

    async setUserWorkspaceToCookies({ dispatch, state }, payload) {
      if (state.loggedUser?.username) {
        let oldValue: Record<string, string>
        try {
          oldValue = await dispatch('getAllUserWorkspacesFromCookies')
        } catch {
          // ignore
        }

        const value = JSON.stringify({
          ...oldValue,
          [state.loggedUser?.username]: payload.id
        })
        const expires = new Date()
        // cookies expire in one year
        expires.setFullYear(expires.getFullYear() + 1)
        cookies.set(COOKIES_CURRENT_WORKSPACE, value, {
          expires
        })
      }
    },

    async setFirstWorkspace({ dispatch, state }) {
      if (state.workspaces.length > 0) {
        await dispatch('setWorkspace', {
          workspaceId: state.workspaces[0].id
        })
      }
    },

    async checkCurrentWorkspace({ dispatch, getters, state }) {
      try {
        await dispatch('getWorkspaces')
        const currentWorkspaceFromCookie = await dispatch(
          'getUserWorkspaceFromCookies'
        )
        if (state.workspaces.length > 0) {
          let foundWorkspace
          let skipSavingInCookies = true
          if (currentWorkspaceFromCookie !== undefined) {
            // try to use workspace stored in cookies
            foundWorkspace = getters.getWorkspaceById({
              id: parseInt(currentWorkspaceFromCookie)
            })
          }
          if (!foundWorkspace) {
            // try to use preferred_workspace from user profile response
            const preferredWorkspaceId = await dispatch(
              'getPreferredWorkspaceId'
            )
            if (preferredWorkspaceId) {
              foundWorkspace = getters.getWorkspaceById({
                id: preferredWorkspaceId
              })
              if (foundWorkspace?.id) {
                // do not skip saving in cookies when using preferredWorkspace
                skipSavingInCookies = false
              }
            }
          }
          // use id from found workspace, if not found fallback to first workspace from user workspaces
          const currentWorkspaceIdToSet =
            foundWorkspace?.id ?? state.workspaces[0].id
          await dispatch('setWorkspace', {
            workspaceId: currentWorkspaceIdToSet,
            // do not save workspaceId to cookies as it could be:
            // * already there, if was loaded from cookies
            // * used the first user workspace as fallback, then it is not a user choice
            skipSavingInCookies
          })
        } else {
          await dispatch('removeUserWorkspaceFromCookies')
        }
      } catch (e) {
        console.warn('Loading of stored user workspace id has failed.', e)
      }
    }
  }
}

export default UserStore
