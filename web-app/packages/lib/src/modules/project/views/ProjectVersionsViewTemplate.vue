<!--
Copyright (C) Lutra Consulting Limited

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MerginMaps-Commercial
-->

<template>
  <app-container>
    <app-section ground class="flex justify-content-end">
      <AppMenu :items="filterMenuItems" />
    </app-section>
    <app-section>
      <PDataView
        :value="items"
        :data-key="'name'"
        :paginator="
          showPagination && options && versionsCount > options.itemsPerPage
        "
        :rows="options.itemsPerPage"
        :totalRecords="versionsCount"
        :paginator-template="'FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink'"
        data-cy="project-version-table"
        lazy
        @page="onPage"
        :pt="{
          header: {
            // small header
            class: 'px-3 py-2'
          }
        }"
      >
        <template #header>
          <div class="w-11 grid grid-nogutter">
            <!-- Visible on lg breakpoint > -->
            <div
              v-for="col in columns.filter((item) => !item.fixed)"
              :class="['paragraph-p6 hidden lg:flex', `col-${col.cols ?? 2}`]"
              :key="col.text"
            >
              {{ col.text }}
            </div>
            <!-- else -->
            <div class="col-12 flex lg:hidden">Versions</div>
          </div>
        </template>

        <!-- table rows -->
        <template #list="slotProps">
          <div
            v-for="item in slotProps.items"
            :key="item.id"
            class="flex align-items-center hover:bg-gray-50 cursor-pointer border-bottom-1 border-gray-200 paragraph-p6 px-3 py-2 mt-0"
            :style="[rowStyle(item)]"
            @click.prevent="!item.disabled && rowClick(item.name)"
          >
            <div class="flex-grow-1 grid grid-nogutter w-11">
              <!-- Columns, we are using data view instead table, it is better handling of respnsive state -->
              <div
                v-for="col in columns.filter((item) => !item.fixed)"
                :key="col.value"
                :class="[
                  'flex flex-column justify-content-center col-12 gap-1',
                  `lg:col-${col.cols ?? 2}`,
                  'py-2 lg:py-0'
                ]"
              >
                <template v-if="col.value === 'name'">
                  <p class="opacity-80 font-semibold font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span :class="col.textClass">
                    {{ item.name }}
                  </span>
                </template>
                <template v-else-if="col.value === 'created'">
                  <p class="paragraph-p6 opacity-80 font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span
                    v-tooltip.bottom="{
                      value: $filters.datetime(item.created)
                    }"
                    :class="col.textClass"
                  >
                    {{ $filters.timediff(item.created) }}
                  </span>
                </template>
                <template v-else-if="col.value === 'changes.added'">
                  <p class="paragraph-p6 opacity-80 font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span :class="col.textClass">{{
                    item.changes.added.length
                  }}</span>
                </template>
                <template v-else-if="col.value === 'changes.updated'">
                  <p class="paragraph-p6 opacity-80 font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span :class="col.textClass">
                    {{ item.changes.updated.length }}
                  </span>
                </template>
                <template v-else-if="col.value === 'changes.removed'">
                  <p class="paragraph-p6 opacity-80 font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span :class="col.textClass">
                    {{ item.changes.removed.length }}
                  </span>
                </template>
                <template v-else-if="col.value === 'project_size'">
                  <p class="paragraph-p6 opacity-80 font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span :class="col.textClass">{{
                    $filters.filesize(item.project_size)
                  }}</span>
                </template>
                <template v-else>
                  <p class="paragraph-p6 opacity-80 font-semibold lg:hidden">
                    {{ col.text }}
                  </p>
                  <span :class="col.textClass">{{ item[col.value] }}</span>
                </template>
              </div>
            </div>
            <!-- actions -->
            <div class="flex w-1 flex-shrink-0 justify-content-end">
              <PButton
                icon="ti ti-download"
                rounded
                plain
                text
                :disabled="item.disabled"
                :style="[rowStyle(item)]"
                class="paragraph-p3"
                data-cy="project-versions-download-btn"
                @click.stop="
                  downloadArchive({
                    url:
                      '/v1/project/download/' +
                      namespace +
                      '/' +
                      projectName +
                      '?version=' +
                      item.name +
                      '&format=zip'
                  })
                "
              />
            </div>
          </div>
        </template>
        <template #empty>
          <div class="w-full text-center p-4">
            <span>No versions found.</span>
          </div>
        </template>
      </PDataView>
      <slot name="table-footer"></slot>
    </app-section>
    <VersionDetailSidebar />
  </app-container>
</template>

<script lang="ts">
import { mapActions, mapState } from 'pinia'
import { DataViewPageEvent } from 'primevue/dataview'
import { MenuItem, MenuItemCommandEvent } from 'primevue/menuitem'
import { defineComponent, PropType } from 'vue'

import VersionDetailSidebar from '../components/VersionDetailSidebar.vue'

import { AppSection, AppContainer } from '@/common/components'
import AppMenu from '@/common/components/AppMenu.vue'
import {
  FetchProjectVersionsParams,
  ProjectVersion,
  ProjectVersionsItem
} from '@/modules'
import { useProjectStore } from '@/modules/project/store'

interface ColumnItem {
  text: string
  value: string
  cols?: number
  fixed?: boolean
  textClass?: string
}

export default defineComponent({
  name: 'ProjectVersionsViewTemplate',
  components: {
    AppSection,
    AppContainer,
    VersionDetailSidebar,
    AppMenu
  },
  props: {
    projectName: String,
    namespace: String,
    asAdmin: {
      type: Boolean,
      default: false
    },
    /** Default items per page */
    defaultItemsPerPage: Number as PropType<number>,
    /** Disabled keys (name attribute of rows in vuetify table are keys for items) */
    disabledKeys: { type: Array as PropType<string[]>, default: () => [] },
    /** Show pagination */
    showPagination: { type: Boolean, default: true }
  },
  data() {
    return {
      columns: [
        {
          text: 'Version',
          value: 'name',
          textClass: 'font-semibold white-space-normal',
          cols: 1
        },
        { text: 'Created', value: 'created' },
        { text: 'Author', value: 'author' },
        {
          text: 'Files added',
          value: 'changes.added'
        },
        {
          text: 'Files edited',
          value: 'changes.updated'
        },
        {
          text: 'Files removed',
          value: 'changes.removed'
        },
        { text: 'Size', value: 'project_size', cols: 1 },
        { text: '', value: 'archived', fixed: true }
      ].map((item) => ({
        ...item,
        textClass: item.textClass === undefined ? 'opacity-80' : item.textClass
      })) as ColumnItem[],
      options: {
        sortDesc: true,
        itemsPerPage: this.defaultItemsPerPage ?? 50,
        page: 1
      }
    }
  },
  computed: {
    ...mapState(useProjectStore, [
      'versions',
      'versionsLoading',
      'versionsCount'
    ]),
    /**
     * Table data from versions in global state transformed
     */
    items(): ProjectVersionsItem[] {
      const versions: ProjectVersion[] = this.versions

      return versions?.map<ProjectVersionsItem>((v) => ({
        ...v,
        disabled: this.disabledKeys.some((d) => d === v.name)
      }))
    },
    filterMenuItems(): MenuItem[] {
      return [
        {
          label: 'Newest versions',
          key: 'newest',
          sortDesc: true
        },
        {
          label: 'Oldest versions',
          key: 'oldest',
          sortDesc: false
        }
      ].map((item) => ({
        ...item,
        command: (e: MenuItemCommandEvent) => this.menuItemClick(e),
        class: this.options.sortDesc === item.sortDesc ? 'bg-primary-400' : ''
      }))
    }
  },
  created() {
    this.fetchVersions()
  },
  methods: {
    ...mapActions(useProjectStore, ['fetchProjectVersions', 'downloadArchive']),
    rowStyle(item: ProjectVersionsItem) {
      return item.disabled && { opacity: 0.5, cursor: 'not-allowed' }
    },
    async fetchVersions() {
      const params: FetchProjectVersionsParams = {
        page: this.options.page,
        per_page: this.options.itemsPerPage,
        descending: this.options.sortDesc
      }
      await this.fetchProjectVersions({
        params,
        namespace: this.namespace,
        projectName: this.projectName
      })
    },
    onPage(e: DataViewPageEvent) {
      this.options.page = e.page + 1
      this.options.itemsPerPage = e.rows
      this.fetchVersions()
    },
    rowClick(name: string) {
      this.$router.push({
        path: `history/${name}`
      })
    },
    menuItemClick(e: MenuItemCommandEvent) {
      this.options.sortDesc = e.item.sortDesc
      this.fetchVersions()
    }
  }
})
</script>

<style lang="scss" scoped></style>
